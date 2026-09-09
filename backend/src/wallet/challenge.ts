import { randomUUID } from "node:crypto";
import { verifyMessage } from "viem";

interface Challenge {
  address: string;
  message: string;
  expiresAt: number;
}

const pending = new Map<string, Challenge>();
const TTL_MS = 5 * 60 * 1000;

function buildMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    "Levantate Bridge — prove wallet ownership",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "",
    "Signing costs no gas and authorizes no transaction. It only links this",
    "wallet to your World ID verification so task payments can be sent here.",
  ].join("\n");
}

export function createWalletChallenge(address: string): {
  challengeToken: string;
  message: string;
  expiresAt: number;
} {
  const challengeToken = randomUUID();
  const message = buildMessage(address, randomUUID(), new Date().toISOString());
  const expiresAt = Date.now() + TTL_MS;
  pending.set(challengeToken, { address: address.toLowerCase(), message, expiresAt });
  return { challengeToken, message, expiresAt };
}

/** Consumes the challenge (single use) and checks the signature really came from `address`. */
export async function consumeWalletChallenge(
  challengeToken: string,
  address: string,
  signature: string,
): Promise<boolean> {
  const entry = pending.get(challengeToken);
  pending.delete(challengeToken);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  if (entry.address !== address.toLowerCase()) return false;

  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message: entry.message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
