export interface Task {
  id: number;
  description: string;
  maxBudget: string;
  bidDeadline: string;
  submissionWindow: string;
  submissionDeadline: string;
  round: number;
  state: number;
  stateLabel: string;
  assignedWorker: string;
  currentRoundBidCount: string;
}

export interface RelayedTransaction {
  transactionId: string;
  status: "queued" | "submitted" | "confirmed" | "failed";
  txHash: string | null;
  kind: string;
  expectedEvent: string;
  taskId: number | null;
  error: string | null;
  updatedAt: string;
}

export interface WorkerSession {
  walletAddress: string;
  /** Present after the first successful bid (or after reconnecting an already-bound wallet). */
  nullifierHash?: string;
  /** Present after linking a wallet that has not yet been bound to a World ID. */
  linkToken?: string;
}

export interface Bid {
  id: number;
  taskId: number;
  round: number;
  workerAddress: string;
  nullifierHash: string;
  amount: string;
  createdAt: string;
}
