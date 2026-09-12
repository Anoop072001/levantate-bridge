import { randomUUID } from "node:crypto";
import { createCircleClient } from "../circle/client.js";
import {
  findRelayedByIdempotencyKey,
  insertRelayedTransaction,
  updateRelayedTransaction,
  type RelayedTransaction,
} from "../store.js";
import { finalizeRelayOnArc } from "./finalize-relay.js";
import { getWalletQueue } from "./queue.js";

export interface ContractCallInput {
  walletId: string;
  kind: string;
  expectedEvent: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: Array<string | number | boolean>;
  taskId?: number;
  round?: number;
  worker?: string;
  idempotencyKey?: string;
}

type CircleWaitResult =
  | { status: "complete"; txHash: string }
  | { status: "failed"; txHash?: string }
  | { status: "timeout" };

async function waitForCircleTx(circleTxId: string): Promise<CircleWaitResult> {
  const client = createCircleClient();
  for (let i = 0; i < 60; i++) {
    const res = await client.getTransaction({ id: circleTxId });
    const state = res.data?.transaction?.state;
    const hash = res.data?.transaction?.txHash;
    if (state === "COMPLETE" && hash) return { status: "complete", txHash: hash };
    if (state === "FAILED") {
      return { status: "failed", txHash: hash ?? undefined };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { status: "timeout" };
}

async function submitContractCall(input: ContractCallInput): Promise<RelayedTransaction> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const existing = await findRelayedByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  const pending = await insertRelayedTransaction({
    idempotencyKey,
    kind: input.kind,
    taskId: input.taskId,
    round: input.round,
    worker: input.worker,
    walletId: input.walletId,
    status: "queued",
    expectedEvent: input.expectedEvent,
  });

  const client = createCircleClient();
  let response;
  try {
    response = await client.createContractExecutionTransaction({
      walletId: input.walletId,
      contractAddress: input.contractAddress,
      abiFunctionSignature: input.abiFunctionSignature,
      abiParameters: input.abiParameters,
      idempotencyKey,
      fee: { type: "level", config: { feeLevel: "LOW" } },
    });
  } catch (err) {
    return updateRelayedTransaction(pending.id, {
      status: "failed",
      error: err instanceof Error ? err.message : "Circle submission failed",
    });
  }

  const circleTxId = response.data?.id;
  if (!circleTxId) {
    return updateRelayedTransaction(pending.id, {
      status: "failed",
      error: "No Circle transaction id returned",
    });
  }

  await updateRelayedTransaction(pending.id, { status: "submitted", circleTxId });

  try {
    const circleResult = await waitForCircleTx(circleTxId);

    if (circleResult.status === "complete") {
      return finalizeRelayOnArc(pending, input, circleResult.txHash);
    }

    if (circleResult.status === "failed") {
      if (circleResult.txHash) {
        console.warn(
          `[relayer] Circle reported FAILED for ${circleTxId} but returned txHash — confirming on Arc`,
        );
      } else {
        console.warn(
          `[relayer] Circle reported FAILED for ${circleTxId} with no hash — checking on-chain effect`,
        );
      }
      return finalizeRelayOnArc(pending, input, circleResult.txHash);
    }

    console.warn(`[relayer] Timed out waiting for Circle transaction ${circleTxId} — checking on-chain effect`);
    return finalizeRelayOnArc(pending, input);
  } catch (err) {
    const recovered = await finalizeRelayOnArc(pending, input);
    if (recovered.status === "confirmed") return recovered;
    return updateRelayedTransaction(pending.id, {
      status: "failed",
      error: err instanceof Error ? err.message : "Transaction failed",
    });
  }
}

export function enqueueContractCall(input: ContractCallInput): Promise<RelayedTransaction> {
  return getWalletQueue(input.walletId).enqueue(() => submitContractCall(input));
}

export function transactionResponse(tx: RelayedTransaction) {
  return {
    transactionId: tx.id,
    status: tx.status,
    txHash: tx.txHash ?? null,
    kind: tx.kind,
    expectedEvent: tx.expectedEvent,
    taskId: tx.taskId ?? null,
    error: tx.error ?? null,
    updatedAt: tx.updatedAt,
  };
}

export function pendingHandle(tx: RelayedTransaction) {
  return transactionResponse(tx);
}

/** Human-readable chain outcome after Circle submit + Arc RPC receipt wait. */
export function relayChainStatus(tx: RelayedTransaction): string {
  switch (tx.status) {
    case "confirmed":
      return "confirmed on-chain (RPC receipt success)";
    case "failed":
      return `failed (${tx.error ?? "reverted or submission error"})`;
    case "submitted":
      return "submitted — awaiting Arc RPC receipt";
    default:
      return tx.status;
  }
}
