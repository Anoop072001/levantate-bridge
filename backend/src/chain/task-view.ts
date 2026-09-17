import type { PublicClient } from "viem";
import { createArcPublicClient } from "./escrow.js";
import { nowSeconds, readNextBidId, readNextTaskId, readOnChainTask, TASK_STATE, type OnChainTask } from "./task-state.js";
import {
  dropRowsFromPriorEscrow,
  getTask,
  listBidsForTask,
  listInFlightRelaysForTask,
  listTasks,
  type TaskRecord,
} from "../store.js";

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

let priorEscrowDrop: Promise<void> | null = null;

async function dropPriorEscrowRows(client: PublicClient): Promise<void> {
  const nextTaskId = await readNextTaskId(client);
  const nextBidId = await readNextBidId(client);
  const stored = await listTasks();
  const liveTasks = stored.filter((t) => t.id >= 0 && t.id < nextTaskId);
  await dropRowsFromPriorEscrow(nextTaskId, nextBidId, liveTasks);
}

/** Once per process: drop Supabase bids/proofs left over from a previous escrow deploy. */
export async function reconcileStoreToCurrentEscrow(client?: PublicClient): Promise<void> {
  const publicClient = client ?? createArcPublicClient();
  priorEscrowDrop ??= dropPriorEscrowRows(publicClient).catch((err) => {
    priorEscrowDrop = null;
    throw err;
  });
  await priorEscrowDrop;
}

function taskRecordFromChain(id: number, onChain: OnChainTask, createdAt?: string): TaskRecord {
  return {
    id,
    description: onChain.description,
    maxBudget: onChain.maxBudget.toString(),
    bidDeadline: onChain.bidDeadline.toString(),
    submissionWindow: onChain.submissionWindow.toString(),
    round: onChain.round,
    state: onChain.state,
    poster: onChain.poster,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

/** DB-backed view when RPC is unavailable. */
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
    description: onChain.description,
    poster: onChain.poster,
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
 * Worker-facing task reads use Arc RPC on the current escrow. The Graph Network subgraph
 * may still index a previous deployment; task ids restart at 0, so joining by id paints
 * cancelled/paid ghosts over live tasks. Budgeting and bid scoring still query the subgraph.
 */
export async function enrichTask(task: TaskRecord, client?: PublicClient) {
  try {
    return await enrichTaskFromRpc(task, client);
  } catch (err) {
    console.warn(
      `[task-view] task ${task.id} — RPC failed, using store snapshot: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return enrichTaskFromStore(task);
  }
}

export type EnrichedTask = Awaited<ReturnType<typeof enrichTask>>;

/**
 * Tasks that exist on the currently configured escrow (`id < nextTaskId`).
 * Drops leftover Supabase rows from prior deployments and fills gaps from RPC.
 */
export async function listLiveTaskRecords(client?: PublicClient): Promise<TaskRecord[]> {
  const publicClient = client ?? createArcPublicClient();
  await reconcileStoreToCurrentEscrow(publicClient);
  const nextId = await readNextTaskId(publicClient);
  const stored = await listTasks();
  const byId = new Map(stored.filter((t) => t.id >= 0 && t.id < nextId).map((t) => [t.id, t]));
  const records: TaskRecord[] = [];

  for (let id = nextId - 1; id >= 0; id--) {
    const existing = byId.get(id);
    if (existing) {
      records.push(existing);
      continue;
    }
    try {
      records.push(taskRecordFromChain(id, await readOnChainTask(id, publicClient)));
    } catch (err) {
      console.warn(
        `[task-view] live task ${id} missing from store and RPC failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  return records;
}

export async function getLiveTaskRecord(
  taskId: number,
  client?: PublicClient,
): Promise<TaskRecord | null> {
  if (!Number.isInteger(taskId) || taskId < 0) return null;
  const publicClient = client ?? createArcPublicClient();
  await reconcileStoreToCurrentEscrow(publicClient);
  const nextId = await readNextTaskId(publicClient);
  if (taskId >= nextId) return null;

  const stored = await getTask(taskId);
  if (stored) return stored;

  try {
    return taskRecordFromChain(taskId, await readOnChainTask(taskId, publicClient));
  } catch (err) {
    console.warn(
      `[task-view] task ${taskId} not in store and RPC failed: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return null;
  }
}

/** List/detail pages: Arc RPC for every live task. */
export async function enrichAllTasks(tasks: TaskRecord[], client?: PublicClient) {
  const publicClient = client ?? createArcPublicClient();
  const enriched = [];

  for (const task of tasks) {
    const base = await enrichTask(task, publicClient);
    enriched.push(await attachAgentActivity(base));
  }

  return enriched;
}

export async function enrichTaskWithActivity(task: TaskRecord, client?: PublicClient) {
  return attachAgentActivity(await enrichTask(task, client));
}
