import { isSubgraphAvailable, querySubgraph } from "../subgraph/client.js";

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

const WORKERS_BATCH_QUERY = `
  query ($ids: [ID!]!) {
    workers(where: { id_in: $ids }) {
      id
      tasksAssigned
      tasksPaid
      missedDeadlines
      completionRate
    }
  }`;

const PAYMENTS_CACHE_MS = 300_000;
const WORKER_CACHE_MS = 300_000;

let paymentsCache: { at: number; data: PaymentRecord[] } | null = null;
let paymentsInflight: Promise<PaymentRecord[]> | null = null;
const workerCache = new Map<string, { at: number; data: WorkerStats | null }>();

export async function fetchHistoricalPayments(): Promise<PaymentRecord[]> {
  const now = Date.now();
  if (paymentsCache && now - paymentsCache.at < PAYMENTS_CACHE_MS) {
    return paymentsCache.data;
  }
  if (paymentsInflight) return paymentsInflight;

  if (!isSubgraphAvailable()) {
    return paymentsCache?.data ?? [];
  }

  paymentsInflight = (async () => {
    try {
      const data = await querySubgraph<{ payments: PaymentRecord[] }>(PAYMENTS_QUERY, {});
      paymentsCache = { at: Date.now(), data: data.payments };
      return data.payments;
    } catch {
      return paymentsCache?.data ?? [];
    } finally {
      paymentsInflight = null;
    }
  })();

  return paymentsInflight;
}

export async function fetchWorkerStats(address: string): Promise<WorkerStats | null> {
  const map = await fetchWorkerStatsBatch([address]);
  return map.get(address.toLowerCase()) ?? null;
}

/** One subgraph round-trip for all bidders instead of one query per bid. */
export async function fetchWorkerStatsBatch(addresses: string[]): Promise<Map<string, WorkerStats | null>> {
  const result = new Map<string, WorkerStats | null>();
  const ids = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (ids.length === 0) return result;

  const now = Date.now();
  const missing: string[] = [];
  for (const id of ids) {
    const cached = workerCache.get(id);
    if (cached && now - cached.at < WORKER_CACHE_MS) {
      result.set(id, cached.data);
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0 || !isSubgraphAvailable()) {
    for (const id of missing) {
      result.set(id, workerCache.get(id)?.data ?? null);
    }
    return result;
  }

  try {
    const data = await querySubgraph<{ workers: WorkerStats[] }>(WORKERS_BATCH_QUERY, { ids: missing });
    const found = new Set<string>();
    for (const worker of data.workers) {
      const id = worker.id.toLowerCase();
      workerCache.set(id, { at: Date.now(), data: worker });
      result.set(id, worker);
      found.add(id);
    }
    for (const id of missing) {
      if (!found.has(id)) {
        workerCache.set(id, { at: Date.now(), data: null });
        result.set(id, null);
      }
    }
  } catch {
    for (const id of missing) {
      result.set(id, workerCache.get(id)?.data ?? null);
    }
  }

  return result;
}

function medianBigInt(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function medianPaidFromPayments(payments: PaymentRecord[]): bigint | null {
  if (payments.length === 0) return null;
  return medianBigInt(payments.map((p) => BigInt(p.workerAmount)));
}

export function medianSubmissionWindowFromPayments(payments: PaymentRecord[]): bigint | null {
  const windows = payments
    .map((p) => p.task?.submissionWindow)
    .filter((w): w is string => w !== undefined && w !== "0");
  if (windows.length === 0) return null;
  return medianBigInt(windows.map(BigInt));
}

export async function fetchMedianPaidAmount(): Promise<bigint | null> {
  return medianPaidFromPayments(await fetchHistoricalPayments());
}

export async function fetchMedianSubmissionWindow(): Promise<bigint | null> {
  return medianSubmissionWindowFromPayments(await fetchHistoricalPayments());
}
