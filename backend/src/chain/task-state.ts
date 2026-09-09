import type { PublicClient } from "viem";
import { createArcPublicClient, getEscrowContract } from "./escrow.js";
import { withRpcQueue } from "./rpc-queue.js";

export const TASK_STATE = ["Open", "Bidding", "Assigned", "Submitted", "Paid", "Cancelled"] as const;
export type TaskStateName = (typeof TASK_STATE)[number];

export interface OnChainTask {
  description: string;
  maxBudget: bigint;
  bidDeadline: bigint;
  submissionWindow: bigint;
  submissionDeadline: bigint;
  round: number;
  state: number;
  stateLabel: TaskStateName;
  assignedWorker: `0x${string}`;
  winningBidId: bigint;
  winningBidAmount: bigint;
  proofHash: `0x${string}`;
  currentRoundBidCount: bigint;
}

/** `tasks(uint256)` return tuple — the ABI is loaded from JSON, so viem cannot infer it. */
type TaskTuple = [
  description: string,
  maxBudget: bigint,
  bidDeadline: bigint,
  submissionWindow: bigint,
  submissionDeadline: bigint,
  round: bigint,
  state: number,
  assignedWorker: string,
  winningBidId: bigint,
  winningBidAmount: bigint,
  proofHash: string,
  currentRoundBidCount: bigint,
];

const rpcCache = new Map<number, { at: number; value: OnChainTask }>();
const RPC_CACHE_MS = 60_000;
const STALE_CACHE_MS = 600_000;

function parseTaskTuple(taskId: number, t: TaskTuple): OnChainTask {
  const state = Number(t[6]);
  return {
    description: t[0],
    maxBudget: t[1],
    bidDeadline: t[2],
    submissionWindow: t[3],
    submissionDeadline: t[4],
    round: Number(t[5]),
    state,
    stateLabel: TASK_STATE[state] ?? "Open",
    assignedWorker: t[7] as `0x${string}`,
    winningBidId: t[8],
    winningBidAmount: t[9],
    proofHash: t[10] as `0x${string}`,
    currentRoundBidCount: t[11],
  };
}

async function readOnChainTaskFromRpcInner(
  taskId: number,
  client: PublicClient,
): Promise<OnChainTask> {
  const escrow = getEscrowContract(client);
  const t = (await escrow.read.tasks([BigInt(taskId)])) as TaskTuple;
  const value = parseTaskTuple(taskId, t);
  rpcCache.set(taskId, { at: Date.now(), value });
  return value;
}

async function readOnChainTaskFromRpc(
  taskId: number,
  client: PublicClient = createArcPublicClient(),
): Promise<OnChainTask> {
  const cached = rpcCache.get(taskId);
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < RPC_CACHE_MS) {
    return cached.value;
  }

  return withRpcQueue(async () => {
    try {
      return await readOnChainTaskFromRpcInner(taskId, client);
    } catch (err) {
      if (cached && age < STALE_CACHE_MS) {
        console.warn(
          `[rpc] tasks(${taskId}) failed — serving stale cache: ${
            err instanceof Error ? err.message : err
          }`,
        );
        return cached.value;
      }
      throw err;
    }
  });
}

/** Live task state from Arc RPC (cached; stale cache used briefly when RPC times out). */
export async function readOnChainTask(
  taskId: number,
  client: PublicClient = createArcPublicClient(),
): Promise<OnChainTask> {
  return readOnChainTaskFromRpc(taskId, client);
}

export function peekCachedOnChainTask(taskId: number): OnChainTask | undefined {
  return rpcCache.get(taskId)?.value;
}

/** Drop cached reads after a relayed write lands so the UI does not show pre-tx state. */
export function invalidateOnChainTaskCache(taskId: number): void {
  rpcCache.delete(taskId);
}

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
