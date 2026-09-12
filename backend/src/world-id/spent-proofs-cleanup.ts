import { deleteSpentProofsForTask } from "../store.js";

const CLEANUP_ON_CONFIRMED = new Set([
  "approve_work",
  "cancel_task",
  "abort_task",
  "reclaim_task",
]);

/** Drop bid fingerprints once a task is paid, cancelled, or reclaimed (new round). */
export async function maybeDeleteSpentProofsForTask(
  kind: string,
  taskId: number | undefined,
): Promise<void> {
  if (taskId === undefined || !CLEANUP_ON_CONFIRMED.has(kind)) return;
  try {
    await deleteSpentProofsForTask(taskId);
  } catch (err) {
    console.warn(
      `[spent_proofs] cleanup for task ${taskId} (${kind}) failed: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
}
