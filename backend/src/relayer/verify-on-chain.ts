import { invalidateOnChainTaskCache, readOnChainTask, type OnChainTask } from "../chain/task-state.js";
import { readArcReceiptOutcome } from "../chain/wait-receipt.js";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface RelayVerifyInput {
  kind: string;
  taskId?: number;
  round?: number;
  worker?: string;
}

export interface OnChainVerification {
  confirmed: boolean;
  txHash?: string;
  note?: string;
}

function workerMatches(task: OnChainTask, worker: string | undefined): boolean {
  if (!worker) return true;
  return task.assignedWorker.toLowerCase() === worker.toLowerCase();
}

function verifySelectWinner(input: RelayVerifyInput, task: OnChainTask): OnChainVerification {
  if (task.state < 2) {
    return { confirmed: false, note: "Task not assigned on-chain" };
  }
  if (task.assignedWorker.toLowerCase() === ZERO) {
    return { confirmed: false, note: "No assigned worker on-chain" };
  }
  if (!workerMatches(task, input.worker)) {
    return {
      confirmed: false,
      note: `Task assigned to ${task.assignedWorker}, expected ${input.worker}`,
    };
  }
  return { confirmed: true, note: "Task already assigned on-chain" };
}

function verifySubmitWork(task: OnChainTask): OnChainVerification {
  if (task.state < 3) {
    return { confirmed: false, note: "Work not submitted on-chain" };
  }
  return { confirmed: true, note: "Work submitted on-chain" };
}

function verifyApproveWork(task: OnChainTask): OnChainVerification {
  if (task.state !== 4) {
    return { confirmed: false, note: "Task not paid on-chain" };
  }
  return { confirmed: true, note: "Payment released on-chain" };
}

function verifyByTaskState(input: RelayVerifyInput, task: OnChainTask): OnChainVerification {
  switch (input.kind) {
    case "select_winner":
      return verifySelectWinner(input, task);
    case "submit_work":
      return verifySubmitWork(task);
    case "approve_work":
      return verifyApproveWork(task);
    default:
      return { confirmed: false, note: `No on-chain fallback for kind ${input.kind}` };
  }
}

/**
 * Arc RPC is the write source of truth. When Circle reports FAILED (or omits a hash),
 * check the receipt if we have one, otherwise infer success from escrow task state.
 */
export async function verifyRelayEffectOnChain(
  input: RelayVerifyInput,
  txHash?: string,
): Promise<OnChainVerification> {
  if (txHash) {
    const outcome = await readArcReceiptOutcome(txHash);
    if (outcome === "confirmed") {
      if (input.taskId !== undefined) invalidateOnChainTaskCache(input.taskId);
      return { confirmed: true, txHash, note: "Arc RPC receipt success" };
    }
    if (outcome === "failed" && input.taskId === undefined) {
      return { confirmed: false, txHash, note: "Arc RPC receipt reverted" };
    }
  }

  if (input.taskId === undefined) {
    return { confirmed: false, note: "No taskId for on-chain state fallback" };
  }

  invalidateOnChainTaskCache(input.taskId);
  const task = await readOnChainTask(input.taskId);
  return verifyByTaskState(input, task);
}
