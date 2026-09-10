import type { PublicClient } from "viem";
import { nowSeconds, readOnChainTask, TASK_STATE } from "./task-state.js";
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

/** DB-backed view when Arc RPC is slow or unavailable — refresh the page to retry live reads. */
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

/**
 * Merges stored task with live on-chain state. Falls back to Supabase when RPC fails so pages
 * still load during Arc testnet outages.
 */
export async function enrichTask(task: TaskRecord, client?: PublicClient) {
  try {
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
  } catch (err) {
    console.warn(
      `[rpc] enrichTask(${task.id}) failed — using stored snapshot: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return enrichTaskFromStore(task);
  }
}

export type EnrichedTask = Awaited<ReturnType<typeof enrichTask>>;

/** List pages: one RPC at a time through the queue instead of N parallel eth_calls. */
export async function enrichAllTasks(tasks: TaskRecord[], client?: PublicClient) {
  const enriched = [];
  for (const task of tasks) {
    enriched.push(await attachAgentActivity(await enrichTask(task, client)));
  }
  return enriched;
}

export async function enrichTaskWithActivity(task: TaskRecord, client?: PublicClient) {
  return attachAgentActivity(await enrichTask(task, client));
}
