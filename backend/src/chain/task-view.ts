import type { PublicClient } from "viem";
import { readOnChainTask } from "./task-state.js";
import type { TaskRecord } from "../store.js";

/**
 * Merges the stored task with its authoritative on-chain state. The store holds the description
 * and creation time; everything that can change on-chain is read back rather than trusted.
 */
export async function enrichTask(task: TaskRecord, client?: PublicClient) {
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
  };
}

export type EnrichedTask = Awaited<ReturnType<typeof enrichTask>>;
