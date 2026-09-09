import { querySubgraph } from "../subgraph/client.js";

export interface PaymentRecord {
  workerAmount: string;
  blockTimestamp: string;
  task: { description: string; submissionWindow: string } | null;
}

export interface WorkerStats {
  id: string;
  tasksAssigned: number;
  tasksPaid: number;
  missedDeadlines: number;
  completionRate: string;
}

const PAYMENTS_QUERY = `
  query {
    payments(first: 100, orderBy: blockTimestamp, orderDirection: desc) {
      workerAmount
      blockTimestamp
      task { description submissionWindow }
    }
  }`;

const WORKER_QUERY = `
  query ($id: ID!) {
    worker(id: $id) {
      id
      tasksAssigned
      tasksPaid
      missedDeadlines
      completionRate
    }
  }`;

export async function fetchHistoricalPayments(): Promise<PaymentRecord[]> {
  const data = await querySubgraph<{ payments: PaymentRecord[] }>(PAYMENTS_QUERY, {});
  return data.payments;
}

export async function fetchWorkerStats(address: string): Promise<WorkerStats | null> {
  const id = address.toLowerCase();
  const data = await querySubgraph<{ worker: WorkerStats | null }>(WORKER_QUERY, { id });
  return data.worker;
}

export async function fetchMedianPaidAmount(): Promise<bigint | null> {
  const payments = await fetchHistoricalPayments();
  if (payments.length === 0) return null;
  const amounts = payments.map((p) => BigInt(p.workerAmount)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return amounts[Math.floor(amounts.length / 2)] ?? null;
}

export async function fetchMedianSubmissionWindow(): Promise<bigint | null> {
  const payments = await fetchHistoricalPayments();
  const windows = payments
    .map((p) => p.task?.submissionWindow)
    .filter((w): w is string => w !== undefined && w !== "0");
  if (windows.length === 0) return null;
  const sorted = windows.map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}
