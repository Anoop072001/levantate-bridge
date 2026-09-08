import type { PublicClient } from "viem";
import { createArcPublicClient, getEscrowContract } from "./escrow.js";

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

export async function readOnChainTask(taskId: number, client: PublicClient = createArcPublicClient()): Promise<OnChainTask> {
  const escrow = getEscrowContract(client);
  const t = await escrow.read.tasks([BigInt(taskId)]);
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

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
