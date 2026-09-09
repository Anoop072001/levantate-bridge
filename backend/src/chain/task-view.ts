import type { PublicClient } from "viem";
import { readOnChainTask, TASK_STATE } from "./task-state.js";
import { listBidsForTask, type TaskRecord } from "../store.js";

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
    enriched.push(await enrichTask(task, client));
  }
  return enriched;
}
