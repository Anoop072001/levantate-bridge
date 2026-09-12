import { invalidateOnChainTaskCache } from "../chain/task-state.js";
import { readArcReceiptOutcome } from "../chain/wait-receipt.js";
import {
  listFailedRelayedTransactions,
  listSubmittedRelayedTransactions,
  updateRelayedTransaction,
} from "../store.js";
import { maybeDeleteSpentProofsForTask } from "../world-id/spent-proofs-cleanup.js";
import { verifyRelayEffectOnChain } from "./verify-on-chain.js";

/** Marks stuck `submitted` rows confirmed/failed once Arc RPC has a receipt. */
export async function reconcileSubmittedTransactions(): Promise<number> {
  const pending = await listSubmittedRelayedTransactions();
  let updated = 0;

  for (const tx of pending) {
    if (!tx.txHash) continue;
    try {
      const outcome = await readArcReceiptOutcome(tx.txHash);
      if (!outcome) continue;

      await updateRelayedTransaction(tx.id, {
        status: outcome,
        error: outcome === "failed" ? "Transaction reverted on-chain" : undefined,
      });
      if (tx.taskId !== undefined) {
        invalidateOnChainTaskCache(tx.taskId);
      }
      if (outcome === "confirmed") {
        await maybeDeleteSpentProofsForTask(tx.kind, tx.taskId);
      }
      updated++;
    } catch (err) {
      console.warn(
        `[relayer] reconcile ${tx.id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return updated;
}

/** Repairs `failed` rows that actually succeeded on Arc (Circle status mismatch). */
export async function reconcileFailedTransactions(): Promise<number> {
  const failed = await listFailedRelayedTransactions();
  let updated = 0;

  for (const tx of failed) {
    try {
      const verified = await verifyRelayEffectOnChain(
        {
          kind: tx.kind,
          taskId: tx.taskId,
          round: tx.round,
          worker: tx.worker,
        },
        tx.txHash,
      );
      if (!verified.confirmed) continue;

      await updateRelayedTransaction(tx.id, {
        status: "confirmed",
        txHash: verified.txHash ?? tx.txHash,
        error: undefined,
      });
      if (tx.taskId !== undefined) {
        invalidateOnChainTaskCache(tx.taskId);
      }
      await maybeDeleteSpentProofsForTask(tx.kind, tx.taskId);
      console.log(
        `[relayer] reconciled failed ${tx.kind} ${tx.id} → confirmed (${verified.note ?? "on-chain"})`,
      );
      updated++;
    } catch (err) {
      console.warn(
        `[relayer] reconcile failed ${tx.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return updated;
}

export async function reconcileRelayedTransactions(): Promise<number> {
  const [submitted, failed] = await Promise.all([
    reconcileSubmittedTransactions(),
    reconcileFailedTransactions(),
  ]);
  return submitted + failed;
}
