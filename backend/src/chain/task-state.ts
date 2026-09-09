import type { PublicClient } from "viem";
import { createArcPublicClient, getEscrowContract } from "./escrow.js";
import { readTaskFromSubgraph } from "../subgraph/task.js";

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

const rpcCache = new Map<number, { at: number; value: OnChainTask }>();
const RPC_CACHE_MS = 8_000;

async function readOnChainTaskFromRpc(
  taskId: number,
  client: PublicClient = createArcPublicClient(),
): Promise<OnChainTask> {
  const cached = rpcCache.get(taskId);
  if (cached && Date.now() - cached.at < RPC_CACHE_MS) {
    return cached.value;
  }

  const escrow = getEscrowContract(client);
  const t = await escrow.read.tasks([BigInt(taskId)]);
  const state = Number(t[6]);
  const value: OnChainTask = {
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
  rpcCache.set(taskId, { at: Date.now(), value });
  return value;
}

/** Prefer subgraph (no RPC quota); fall back to cached RPC read when not indexed yet. */
export async function readOnChainTask(
  taskId: number,
  client: PublicClient = createArcPublicClient(),
): Promise<OnChainTask> {
  try {
    const indexed = await readTaskFromSubgraph(taskId);
    if (indexed) return indexed;
  } catch {
    /* subgraph unavailable or query error — use RPC */
  }
  return readOnChainTaskFromRpc(taskId, client);
}

export function invalidateTaskRpcCache(taskId: number): void {
  rpcCache.delete(taskId);
}

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
