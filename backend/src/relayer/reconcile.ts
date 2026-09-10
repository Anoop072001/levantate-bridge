import { invalidateOnChainTaskCache } from "../chain/task-state.js";
import { readArcReceiptOutcome } from "../chain/wait-receipt.js";
import { listSubmittedRelayedTransactions, updateRelayedTransaction } from "../store.js";

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
      updated++;
    } catch (err) {
      console.warn(
        `[relayer] reconcile ${tx.id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return updated;
}
