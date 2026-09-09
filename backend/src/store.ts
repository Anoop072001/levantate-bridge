import { randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabase } from "./db/supabase.js";

export interface WorkerRecord {
  nullifierHash: string;
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

interface WorkerRow {
  nullifier_hash: string;
  address: string;
  signal: string;
  created_at: string;
}

interface TaskRow {
  id: number;
  description: string;
  max_budget: string;
  bid_deadline: string;
  submission_window: string;
  round: number;
  state: number;
  created_at: string;
}

interface BidRow {
  id: number;
  task_id: number;
  round: number;
  worker_address: string;
  nullifier_hash: string;
  amount: string;
  created_at: string;
}

interface ProofRow {
  task_id: number;
  round: number;
  content: string;
  content_hash: string;
  created_at: string;
}

interface RelayedRow {
  id: string;
  idempotency_key: string;
  kind: string;
  task_id: number | null;
  round: number | null;
  worker: string | null;
  wallet_id: string;
  circle_tx_id: string | null;
  tx_hash: string | null;
  status: RelayedTxStatus;
  expected_event: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Postgres "no rows returned" from `.single()` — an expected miss, not a failure. */
const NOT_FOUND = "PGRST116";

function fail(context: string, error: PostgrestError): never {
  throw new Error(`${context}: ${error.message}`);
}

function toWorker(row: WorkerRow): WorkerRecord {
  return {
    nullifierHash: row.nullifier_hash,
    address: row.address,
    signal: row.signal,
    createdAt: row.created_at,
  };
}

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    description: row.description,
    maxBudget: row.max_budget,
    bidDeadline: row.bid_deadline,
    submissionWindow: row.submission_window,
    round: row.round,
    state: row.state,
    createdAt: row.created_at,
  };
}

function toBid(row: BidRow): BidRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    round: row.round,
    workerAddress: row.worker_address,
    nullifierHash: row.nullifier_hash,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function toProof(row: ProofRow): ProofRecord {
  return {
    taskId: row.task_id,
    round: row.round,
    content: row.content,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

function toRelayed(row: RelayedRow): RelayedTransaction {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    taskId: row.task_id ?? undefined,
    round: row.round ?? undefined,
    worker: row.worker ?? undefined,
    walletId: row.wallet_id,
    circleTxId: row.circle_tx_id ?? undefined,
    txHash: row.tx_hash ?? undefined,
    status: row.status,
    expectedEvent: row.expected_event,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findWorkerByNullifier(
  nullifierHash: string,
): Promise<WorkerRecord | undefined> {
  const { data, error } = await getSupabase()
    .from("workers")
    .select("*")
    .ilike("nullifier_hash", nullifierHash)
    .maybeSingle<WorkerRow>();
  if (error) fail("findWorkerByNullifier", error);
  return data ? toWorker(data) : undefined;
}

export async function findWorkerByAddress(address: string): Promise<WorkerRecord | undefined> {
  const { data, error } = await getSupabase()
    .from("workers")
    .select("*")
    .ilike("address", address)
    .maybeSingle<WorkerRow>();
  if (error) fail("findWorkerByAddress", error);
  return data ? toWorker(data) : undefined;
}

export async function insertWorker(record: WorkerRecord): Promise<void> {
  const { error } = await getSupabase().from("workers").insert({
    nullifier_hash: record.nullifierHash,
    address: record.address,
    signal: record.signal,
    created_at: record.createdAt,
  });
  if (error) fail("insertWorker", error);
}

export interface LinkedWallet {
  address: string;
  linkToken: string;
}

export async function upsertLinkedWallet(address: string): Promise<LinkedWallet> {
  const linkToken = randomUUID();
  const { error } = await getSupabase().from("linked_wallets").upsert(
    {
      address: address.toLowerCase(),
      link_token: linkToken,
      created_at: new Date().toISOString(),
    },
    { onConflict: "address" },
  );
  if (error) fail("upsertLinkedWallet", error);
  return { address: address.toLowerCase(), linkToken };
}

export async function findLinkedWallet(
  address: string,
  linkToken: string,
): Promise<LinkedWallet | undefined> {
  const { data, error } = await getSupabase()
    .from("linked_wallets")
    .select("address, link_token")
    .ilike("address", address)
    .eq("link_token", linkToken)
    .maybeSingle<{ address: string; link_token: string }>();
  if (error) fail("findLinkedWallet", error);
  if (!data) return undefined;
  return { address: data.address, linkToken: data.link_token };
}

export async function deleteLinkedWallet(address: string): Promise<void> {
  const { error } = await getSupabase()
    .from("linked_wallets")
    .delete()
    .ilike("address", address);
  if (error) fail("deleteLinkedWallet", error);
}

export async function insertPendingSignal(
  token: string,
  signal: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await getSupabase().from("pending_signals").insert({
    token,
    signal,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
  if (error) fail("insertPendingSignal", error);
}

/** Single-use: deletes the row and returns whether the signal matched and had not expired. */
export async function consumePendingSignal(token: string, signal: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("pending_signals")
    .select("signal, expires_at")
    .eq("token", token)
    .maybeSingle<{ signal: string; expires_at: string }>();
  if (error) fail("consumePendingSignal", error);
  if (!data) return false;

  await getSupabase().from("pending_signals").delete().eq("token", token);

  if (new Date(data.expires_at).getTime() <= Date.now()) return false;
  return data.signal === signal;
}

/** Returns false if this proof was already spent. */
export async function trySpendProof(
  fingerprint: string,
  nullifierHash: string,
): Promise<boolean> {
  const { error } = await getSupabase().from("spent_proofs").insert({
    fingerprint,
    nullifier_hash: nullifierHash,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  fail("trySpendProof", error);
}

export async function upsertTask(record: TaskRecord): Promise<void> {
  const { error } = await getSupabase().from("tasks").upsert(
    {
      id: record.id,
      description: record.description,
      max_budget: record.maxBudget,
      bid_deadline: record.bidDeadline,
      submission_window: record.submissionWindow,
      round: record.round,
      state: record.state,
      created_at: record.createdAt,
    },
    { onConflict: "id" },
  );
  if (error) fail("upsertTask", error);
}

export async function listTasks(): Promise<TaskRecord[]> {
  const { data, error } = await getSupabase()
    .from("tasks")
    .select("*")
    .order("id", { ascending: true })
    .returns<TaskRow[]>();
  if (error) fail("listTasks", error);
  return (data ?? []).map(toTask);
}

export async function getTask(id: number): Promise<TaskRecord | undefined> {
  const { data, error } = await getSupabase()
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle<TaskRow>();
  if (error) fail("getTask", error);
  return data ? toTask(data) : undefined;
}

export async function insertBid(record: BidRecord): Promise<void> {
  const { error } = await getSupabase().from("bids").insert({
    id: record.id,
    task_id: record.taskId,
    round: record.round,
    worker_address: record.workerAddress,
    nullifier_hash: record.nullifierHash,
    amount: record.amount,
    created_at: record.createdAt,
  });
  if (error) fail("insertBid", error);
}

export async function listBidsForTask(taskId: number, round?: number): Promise<BidRecord[]> {
  let query = getSupabase().from("bids").select("*").eq("task_id", taskId);
  if (round !== undefined) query = query.eq("round", round);
  const { data, error } = await query.order("id", { ascending: true }).returns<BidRow[]>();
  if (error) fail("listBidsForTask", error);
  return (data ?? []).map(toBid);
}

export async function getBid(bidId: number): Promise<BidRecord | undefined> {
  const { data, error } = await getSupabase()
    .from("bids")
    .select("*")
    .eq("id", bidId)
    .maybeSingle<BidRow>();
  if (error) fail("getBid", error);
  return data ? toBid(data) : undefined;
}

export async function upsertProof(record: ProofRecord): Promise<void> {
  const { error } = await getSupabase().from("proofs").upsert(
    {
      task_id: record.taskId,
      round: record.round,
      content: record.content,
      content_hash: record.contentHash,
      created_at: record.createdAt,
    },
    { onConflict: "task_id,round" },
  );
  if (error) fail("upsertProof", error);
}

export async function getProof(taskId: number, round: number): Promise<ProofRecord | undefined> {
  const { data, error } = await getSupabase()
    .from("proofs")
    .select("*")
    .eq("task_id", taskId)
    .eq("round", round)
    .maybeSingle<ProofRow>();
  if (error) fail("getProof", error);
  return data ? toProof(data) : undefined;
}

export async function insertRelayedTransaction(
  record: Omit<RelayedTransaction, "id" | "createdAt" | "updatedAt">,
): Promise<RelayedTransaction> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("relayed_transactions")
    .insert({
      id: randomUUID(),
      idempotency_key: record.idempotencyKey,
      kind: record.kind,
      task_id: record.taskId ?? null,
      round: record.round ?? null,
      worker: record.worker ?? null,
      wallet_id: record.walletId,
      circle_tx_id: record.circleTxId ?? null,
      tx_hash: record.txHash ?? null,
      status: record.status,
      expected_event: record.expectedEvent,
      error: record.error ?? null,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single<RelayedRow>();
  if (error) fail("insertRelayedTransaction", error);
  return toRelayed(data);
}

export async function updateRelayedTransaction(
  id: string,
  patch: Partial<RelayedTransaction>,
): Promise<RelayedTransaction> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.circleTxId !== undefined) row.circle_tx_id = patch.circleTxId;
  if (patch.txHash !== undefined) row.tx_hash = patch.txHash;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.error !== undefined) row.error = patch.error;

  const { data, error } = await getSupabase()
    .from("relayed_transactions")
    .update(row)
    .eq("id", id)
    .select()
    .single<RelayedRow>();
  if (error) {
    if (error.code === NOT_FOUND) throw new Error("Relayed transaction not found");
    fail("updateRelayedTransaction", error);
  }
  return toRelayed(data);
}

export async function getRelayedTransaction(id: string): Promise<RelayedTransaction | undefined> {
  const { data, error } = await getSupabase()
    .from("relayed_transactions")
    .select("*")
    .eq("id", id)
    .maybeSingle<RelayedRow>();
  if (error) fail("getRelayedTransaction", error);
  return data ? toRelayed(data) : undefined;
}

export async function findRelayedByIdempotencyKey(
  key: string,
): Promise<RelayedTransaction | undefined> {
  const { data, error } = await getSupabase()
    .from("relayed_transactions")
    .select("*")
    .eq("idempotency_key", key)
    .maybeSingle<RelayedRow>();
  if (error) fail("findRelayedByIdempotencyKey", error);
  return data ? toRelayed(data) : undefined;
}

export async function listSubmittedRelayedTransactions(): Promise<RelayedTransaction[]> {
  const { data, error } = await getSupabase()
    .from("relayed_transactions")
    .select("*")
    .eq("status", "submitted")
    .order("created_at", { ascending: true })
    .returns<RelayedRow[]>();
  if (error) fail("listSubmittedRelayedTransactions", error);
  return (data ?? []).map(toRelayed);
}
