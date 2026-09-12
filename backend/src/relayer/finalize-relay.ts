import { invalidateOnChainTaskCache } from "../chain/task-state.js";
import { invalidateSubgraphTaskCache } from "../subgraph/tasks.js";
import { waitForArcReceipt } from "../chain/wait-receipt.js";
import { updateRelayedTransaction, type RelayedTransaction } from "../store.js";
import { maybeDeleteSpentProofsForTask } from "../world-id/spent-proofs-cleanup.js";
import type { ContractCallInput } from "./submit.js";
import { verifyRelayEffectOnChain } from "./verify-on-chain.js";

async function markConfirmed(
  relayId: string,
  input: ContractCallInput,
  txHash?: string,
  note?: string,
): Promise<RelayedTransaction> {
  if (input.taskId !== undefined) {
    invalidateOnChainTaskCache(input.taskId);
    invalidateSubgraphTaskCache();
  }
  const confirmed = await updateRelayedTransaction(relayId, {
    txHash,
    status: "confirmed",
    error: undefined,
  });
  await maybeDeleteSpentProofsForTask(input.kind, input.taskId);
  if (note) {
    console.log(`[relayer] ${input.kind} confirmed via ${note}${txHash ? ` (${txHash})` : ""}`);
  }
  return confirmed;
}

/** Confirms a relay via Arc receipt and/or on-chain task state (Circle may report FAILED incorrectly). */
export async function finalizeRelayOnArc(
  pending: RelayedTransaction,
  input: ContractCallInput,
  txHash?: string,
): Promise<RelayedTransaction> {
  if (txHash) {
    await updateRelayedTransaction(pending.id, { txHash, status: "submitted" });

    try {
      const outcome = await waitForArcReceipt(txHash);
      if (outcome === "failed") {
        const fallback = await verifyRelayEffectOnChain(input, txHash);
        if (fallback.confirmed) {
          return markConfirmed(pending.id, input, txHash, fallback.note);
        }
        return updateRelayedTransaction(pending.id, {
          txHash,
          status: "failed",
          error: "Transaction reverted on-chain",
        });
      }
      return markConfirmed(pending.id, input, txHash, "Arc RPC receipt");
    } catch (receiptErr) {
      const fallback = await verifyRelayEffectOnChain(input, txHash);
      if (fallback.confirmed) {
        return markConfirmed(pending.id, input, txHash, fallback.note);
      }
      console.warn(
        `[relayer] receipt wait incomplete for ${txHash}: ${
          receiptErr instanceof Error ? receiptErr.message : receiptErr
        }`,
      );
      return updateRelayedTransaction(pending.id, { txHash, status: "submitted" });
    }
  }

  const verified = await verifyRelayEffectOnChain(input);
  if (verified.confirmed) {
    return markConfirmed(pending.id, input, verified.txHash, verified.note);
  }

  return updateRelayedTransaction(pending.id, {
    status: "failed",
    error: verified.note ?? "Transaction failed",
  });
}
