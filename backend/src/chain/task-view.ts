import type { PublicClient } from "viem";
import { createArcPublicClient } from "./escrow.js";
import { nowSeconds, readOnChainTask, TASK_STATE } from "./task-state.js";
import {
  fetchSubgraphTask,
  fetchSubgraphTasksBatch,
  mapSubgraphTaskRow,
} from "../subgraph/tasks.js";
import { listBidsForTask, listInFlightRelaysForTask, type TaskRecord } from "../store.js";

export type AgentActivity =
  | {
      phase: "selecting_winner";
      relayStatus: "queued" | "submitted";
      txHash: string | null;
    }
  | { phase: "waiting_for_agent" };

function taskNeedsWinnerSelection(task: {
  state: number;
  bidDeadline: string;
  currentRoundBidCount: string;
}): boolean {
  const inBidWindow = task.state === 0 || task.state === 1;
  const deadlinePassed = nowSeconds() > Number(task.bidDeadline);
  return inBidWindow && deadlinePassed && Number(task.currentRoundBidCount) > 0;
}

async function attachAgentActivity<T extends Awaited<ReturnType<typeof enrichTask>>>(
  task: T,
): Promise<T & { agentActivity?: AgentActivity }> {
  if (!taskNeedsWinnerSelection(task)) return task;

  const inFlight = await listInFlightRelaysForTask(task.id);
  const select = inFlight.find((tx) => tx.kind === "select_winner");
  if (select) {
    return {
      ...task,
      agentActivity: {
        phase: "selecting_winner",
        relayStatus: select.status as "queued" | "submitted",
        txHash: select.txHash ?? null,
      },
    };
  }

  return { ...task, agentActivity: { phase: "waiting_for_agent" } };
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** DB-backed view when neither subgraph nor RPC is available. */
export async function enrichTaskFromStore(task: TaskRecord, bidCount?: number) {
  const bids =
    bidCount !== undefined
      ? bidCount
      : (await listBidsForTask(task.id, task.round)).length;
  return {
    ...task,
    submissionDeadline: "0",
    stateLabel: TASK_STATE[task.state] ?? "Open",
    assignedWorker: ZERO,
    currentRoundBidCount: String(bids),
    stale: true as const,
  };
}

async function enrichTaskFromRpc(task: TaskRecord, client?: PublicClient) {
  const onChain = await readOnChainTask(task.id, client);
  return {
    ...task,
    bidDeadline: onChain.bidDeadline.toString(),
    submissionWindow: onChain.submissionWindow.toString(),
    submissionDeadline: onChain.submissionDeadline.toString(),
    round: onChain.round,
    state: onChain.state,
    stateLabel: onChain.stateLabel,
    assignedWorker: onChain.assignedWorker,
    currentRoundBidCount: onChain.currentRoundBidCount.toString(),
    maxBudget: onChain.maxBudget.toString(),
    stale: false as const,
  };
}

/**
 * Worker-facing task reads prefer The Graph (one batch query for lists). Arc RPC is fallback only
 * when the subgraph is down or has not indexed the task yet. Writes still confirm via Arc RPC.
 */
export async function enrichTask(task: TaskRecord, client?: PublicClient) {
  const subgraph = await fetchSubgraphTask(String(task.id));
  if (subgraph) {
    return { ...task, ...mapSubgraphTaskRow(subgraph) };
  }

  try {
    return await enrichTaskFromRpc(task, client);
  } catch (err) {
    console.warn(
      `[task-view] task ${task.id} — subgraph miss and RPC failed, using store snapshot: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return enrichTaskFromStore(task);
  }
}

export type EnrichedTask = Awaited<ReturnType<typeof enrichTask>>;

/** List/detail pages: one subgraph round-trip for all tasks, RPC only for gaps. */
export async function enrichAllTasks(tasks: TaskRecord[], client?: PublicClient) {
  const publicClient = client ?? createArcPublicClient();
  const subgraphMap = await fetchSubgraphTasksBatch(tasks.map((t) => String(t.id)));
  const enriched = [];

  for (const task of tasks) {
    const subgraph = subgraphMap.get(String(task.id));
    let base: Awaited<ReturnType<typeof enrichTask>>;
    if (subgraph) {
      base = { ...task, ...mapSubgraphTaskRow(subgraph) };
    } else {
      base = await enrichTask(task, publicClient);
    }
    enriched.push(await attachAgentActivity(base));
  }

  return enriched;
}

export async function enrichTaskWithActivity(task: TaskRecord, client?: PublicClient) {
  return attachAgentActivity(await enrichTask(task, client));
}
