import { createArcPublicClient } from "./escrow.js";

const RECEIPT_TIMEOUT_MS = 90_000;

/** Waits for an Arc RPC receipt. Reverted txs return "failed"; success returns "confirmed". */
export async function waitForArcReceipt(txHash: string): Promise<"confirmed" | "failed"> {
  const client = createArcPublicClient();
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    timeout: RECEIPT_TIMEOUT_MS,
    confirmations: 1,
  });
  return receipt.status === "success" ? "confirmed" : "failed";
}

/** Reads an existing receipt without waiting (startup recovery). */
export async function readArcReceiptOutcome(
  txHash: string,
): Promise<"confirmed" | "failed" | undefined> {
  const client = createArcPublicClient();
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (!receipt) return undefined;
  return receipt.status === "success" ? "confirmed" : "failed";
}
