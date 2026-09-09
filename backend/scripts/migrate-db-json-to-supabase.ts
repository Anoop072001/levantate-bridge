/**
 * One-shot import of the pre-Supabase `data/db.json` file store into Supabase.
 * Worker rows are skipped: they carried custodial Circle wallet ids, and workers
 * now re-link a self-custodied address at verification time.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRootEnv } from "../src/env.js";
import { getSupabase } from "../src/db/supabase.js";

loadRootEnv();

const path = resolve(import.meta.dirname, "../data/db.json");
const raw = JSON.parse(readFileSync(path, "utf8")) as {
  tasks?: Array<Record<string, string | number>>;
  bids?: Array<Record<string, string | number>>;
  proofs?: Array<Record<string, string | number>>;
  relayedTransactions?: Array<Record<string, string | number | undefined>>;
};

const supabase = getSupabase();

async function push(table: string, rows: Array<Record<string, unknown>>, onConflict: string) {
  if (rows.length === 0) {
    console.log(`${table}: nothing to import`);
    return;
  }
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: imported ${rows.length}`);
}

await push(
  "tasks",
  (raw.tasks ?? []).map((t) => ({
    id: t.id,
    description: t.description,
    max_budget: t.maxBudget,
    bid_deadline: t.bidDeadline,
    submission_window: t.submissionWindow,
    round: t.round,
    state: t.state,
    created_at: t.createdAt,
  })),
  "id",
);

await push(
  "bids",
  (raw.bids ?? []).map((b) => ({
    id: b.id,
    task_id: b.taskId,
    round: b.round,
    worker_address: b.workerAddress,
    nullifier_hash: b.nullifierHash,
    amount: b.amount,
    created_at: b.createdAt,
  })),
  "id",
);

await push(
  "proofs",
  (raw.proofs ?? []).map((p) => ({
    task_id: p.taskId,
    round: p.round,
    content: p.content,
    content_hash: p.contentHash,
    created_at: p.createdAt,
  })),
  "task_id,round",
);

await push(
  "relayed_transactions",
  (raw.relayedTransactions ?? []).map((t) => ({
    id: t.id,
    idempotency_key: t.idempotencyKey,
    kind: t.kind,
    task_id: t.taskId ?? null,
    round: t.round ?? null,
    worker: t.worker ?? null,
    wallet_id: t.walletId,
    circle_tx_id: t.circleTxId ?? null,
    tx_hash: t.txHash ?? null,
    status: t.status,
    expected_event: t.expectedEvent,
    error: t.error ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  })),
  "id",
);

console.log("Import complete. Verified workers must re-link a self-custodied wallet at /verify.");
