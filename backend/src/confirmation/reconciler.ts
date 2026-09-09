import type { PublicClient } from "viem";
import { createArcPublicClient } from "../chain/escrow.js";
import { subgraphHasExpectedEvent } from "../subgraph/find-event.js";
import {
  listSubmittedRelayedTransactions,
  updateRelayedTransaction,
  type RelayedTransaction,
} from "../store.js";
import { syncStoredTaskFromChain } from "./sync-task.js";

const POLL_MS = 8_000;
const CONFIRM_TIMEOUT_MS = 120_000;

const ESCROW_EVENTS = new Set([
  "TaskPosted",
  "BidPlaced",
  "WorkerAssigned",
  "WorkSubmitted",
  "WorkRejected",
  "PaymentReleased",
  "TaskReclaimed",
  "TaskCancelled",
]);

async function diagnoseReceipt(
  client: PublicClient,
  txHash: `0x${string}`,
): Promise<"pending" | "success" | "reverted"> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (!receipt) return "pending";
    return receipt.status === "success" ? "success" : "reverted";
  } catch {
    return "pending";
  }
}

function submittedAgeMs(tx: RelayedTransaction): number {
  return Date.now() - new Date(tx.updatedAt).getTime();
}

async function reconcileOne(tx: RelayedTransaction, client: PublicClient): Promise<void> {
  if (tx.status !== "submitted" || !tx.txHash) return;

  if (tx.expectedEvent === "Approval") {
    const outcome = await diagnoseReceipt(client, tx.txHash as `0x${string}`);
    if (outcome === "reverted") {
      updateRelayedTransaction(tx.id, {
        status: "failed",
        error: "USDC approval reverted on-chain",
      });
      return;
    }
    if (outcome === "success") {
      updateRelayedTransaction(tx.id, { status: "confirmed" });
    }
    return;
  }

  if (!ESCROW_EVENTS.has(tx.expectedEvent)) return;

  try {
    const indexed = await subgraphHasExpectedEvent(tx.expectedEvent, tx.txHash);
    if (indexed) {
      updateRelayedTransaction(tx.id, { status: "confirmed" });
      if (tx.taskId !== undefined) {
        await syncStoredTaskFromChain(tx.taskId);
      }
      return;
    }
  } catch (err) {
    console.error(`Subgraph lookup failed for ${tx.id}:`, err instanceof Error ? err.message : err);
    return;
  }

  if (submittedAgeMs(tx) < CONFIRM_TIMEOUT_MS) return;

  const outcome = await diagnoseReceipt(client, tx.txHash as `0x${string}`);
  if (outcome === "reverted") {
    updateRelayedTransaction(tx.id, {
      status: "failed",
      error: `${tx.expectedEvent} transaction reverted on-chain`,
    });
  }
}

export async function reconcileSubmittedTransactions(): Promise<number> {
  const client = createArcPublicClient();
  const pending = listSubmittedRelayedTransactions();
  for (const tx of pending) {
    await reconcileOne(tx, client);
  }
  return pending.length;
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startConfirmationReconciler(): void {
  if (timer) return;

  void reconcileSubmittedTransactions().then((count) => {
    if (count > 0) {
      console.log(`Confirmation reconciler: processed ${count} in-flight transaction(s) on startup`);
    }
  });

  timer = setInterval(() => {
    void reconcileSubmittedTransactions().catch((err) => {
      console.error("Confirmation reconciler error:", err instanceof Error ? err.message : err);
    });
  }, POLL_MS);
}

export function stopConfirmationReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
