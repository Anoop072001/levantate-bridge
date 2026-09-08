import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface WorkerRecord {
  nullifierHash: string;
  circleWalletId: string;
  address: string;
  signal: string;
  createdAt: string;
}

export interface TaskRecord {
  id: number;
  description: string;
  maxBudget: string;
  bidDeadline: string;
  submissionWindow: string;
  round: number;
  state: number;
  createdAt: string;
}

export interface BidRecord {
  id: number;
  taskId: number;
  round: number;
  workerAddress: string;
  nullifierHash: string;
  amount: string;
  createdAt: string;
}

export interface ProofRecord {
  taskId: number;
  round: number;
  content: string;
  contentHash: string;
  createdAt: string;
}

export type RelayedTxStatus = "queued" | "submitted" | "confirmed" | "failed";

export interface RelayedTransaction {
  id: string;
  idempotencyKey: string;
  kind: string;
  taskId?: number;
  round?: number;
  worker?: string;
  walletId: string;
  circleTxId?: string;
  txHash?: string;
  status: RelayedTxStatus;
  expectedEvent: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  workers: WorkerRecord[];
  tasks: TaskRecord[];
  bids: BidRecord[];
  proofs: ProofRecord[];
  relayedTransactions: RelayedTransaction[];
}

const DATA_PATH = resolve(import.meta.dirname, "../data/db.json");

function load(): StoreData {
  try {
    const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as Partial<StoreData>;
    return {
      workers: raw.workers ?? [],
      tasks: raw.tasks ?? [],
      bids: raw.bids ?? [],
      proofs: raw.proofs ?? [],
      relayedTransactions: raw.relayedTransactions ?? [],
    };
  } catch {
    return { workers: [], tasks: [], bids: [], proofs: [], relayedTransactions: [] };
  }
}

function save(data: StoreData): void {
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function findWorkerByNullifier(nullifierHash: string): WorkerRecord | undefined {
  const normalized = nullifierHash.toLowerCase();
  return load().workers.find((w) => w.nullifierHash.toLowerCase() === normalized);
}

export function insertWorker(record: WorkerRecord): void {
  const data = load();
  if (data.workers.some((w) => w.nullifierHash.toLowerCase() === record.nullifierHash.toLowerCase())) {
    throw new Error("Nullifier already registered");
  }
  data.workers.push(record);
  save(data);
}

export function upsertTask(record: TaskRecord): void {
  const data = load();
  const idx = data.tasks.findIndex((t) => t.id === record.id);
  if (idx >= 0) data.tasks[idx] = record;
  else data.tasks.push(record);
  save(data);
}

export function listTasks(): TaskRecord[] {
  return load().tasks;
}

export function getTask(id: number): TaskRecord | undefined {
  return load().tasks.find((t) => t.id === id);
}

export function insertBid(record: BidRecord): void {
  const data = load();
  data.bids.push(record);
  save(data);
}

export function listBidsForTask(taskId: number, round?: number): BidRecord[] {
  return load().bids.filter((b) => b.taskId === taskId && (round === undefined || b.round === round));
}

export function getBid(bidId: number): BidRecord | undefined {
  return load().bids.find((b) => b.id === bidId);
}

export function upsertProof(record: ProofRecord): void {
  const data = load();
  const idx = data.proofs.findIndex((p) => p.taskId === record.taskId && p.round === record.round);
  if (idx >= 0) data.proofs[idx] = record;
  else data.proofs.push(record);
  save(data);
}

export function getProof(taskId: number, round: number): ProofRecord | undefined {
  return load().proofs.find((p) => p.taskId === taskId && p.round === round);
}

export function insertRelayedTransaction(record: Omit<RelayedTransaction, "id" | "createdAt" | "updatedAt">): RelayedTransaction {
  const data = load();
  const row: RelayedTransaction = {
    ...record,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.relayedTransactions.push(row);
  save(data);
  return row;
}

export function updateRelayedTransaction(id: string, patch: Partial<RelayedTransaction>): RelayedTransaction {
  const data = load();
  const idx = data.relayedTransactions.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error("Relayed transaction not found");
  data.relayedTransactions[idx] = {
    ...data.relayedTransactions[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  save(data);
  return data.relayedTransactions[idx];
}

export function getRelayedTransaction(id: string): RelayedTransaction | undefined {
  return load().relayedTransactions.find((t) => t.id === id);
}

export function findRelayedByIdempotencyKey(key: string): RelayedTransaction | undefined {
  return load().relayedTransactions.find((t) => t.idempotencyKey === key);
}

export function listSubmittedRelayedTransactions(): RelayedTransaction[] {
  return load().relayedTransactions.filter((t) => t.status === "submitted");
}
