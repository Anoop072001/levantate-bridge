import { readOnChainTask } from "../chain/task-state.js";
import { getTask, upsertTask } from "../store.js";

export async function syncStoredTaskFromChain(taskId: number): Promise<void> {
  const stored = getTask(taskId);
  if (!stored) return;

  const onChain = await readOnChainTask(taskId);
  upsertTask({
    ...stored,
    maxBudget: onChain.maxBudget.toString(),
    bidDeadline: onChain.bidDeadline.toString(),
    submissionWindow: onChain.submissionWindow.toString(),
    round: onChain.round,
    state: onChain.state,
  });
}
