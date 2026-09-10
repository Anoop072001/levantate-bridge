import type { IncomingMessage, ServerResponse } from "node:http";
import { isAddress } from "viem";
import { requireEnv } from "../env.js";
import {
  findLinkedWallet,
  findWorkerByAddress,
  findWorkerByNullifier,
  updateWorkerAddress,
  deleteLinkedWallet,
} from "../store.js";
import { verifySelfieCheck } from "../world-id/verify.js";

/**
 * Binds a Selfie Check proof to one payout-address change. Mirrored in
 * `frontend/lib/change-payout-signal.ts`.
 */
export function changePayoutSignal(address: string): string {
  return `change-payout:${address.toLowerCase()}`;
}

export async function handleWorkerRoute(
  req: IncomingMessage,
  _res: ServerResponse,
  url: URL,
  body: unknown,
  json: (status: number, payload: unknown) => void,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/worker/payout") {
    const nullifierHash = url.searchParams.get("nullifierHash")?.trim();
    const walletAddress = url.searchParams.get("walletAddress")?.trim();

    if (nullifierHash) {
      const worker = await findWorkerByNullifier(nullifierHash);
      if (!worker) {
        json(404, { error: "No registered payout for this World ID" });
        return true;
      }
      json(200, {
        registeredAddress: worker.address,
        nullifierHash: worker.nullifierHash,
      });
      return true;
    }

    if (walletAddress && isAddress(walletAddress)) {
      const worker = await findWorkerByAddress(walletAddress);
      if (!worker) {
        json(404, { error: "This wallet is not a registered payout address" });
        return true;
      }
      json(200, {
        registeredAddress: worker.address,
        nullifierHash: worker.nullifierHash,
      });
      return true;
    }

    json(400, { error: "nullifierHash or walletAddress query param required" });
    return true;
  }

  if (req.method !== "POST" || url.pathname !== "/api/worker/change-payout-wallet") {
    return false;
  }

  const input = body as {
    walletAddress?: string;
    linkToken?: string;
    rp_id?: string;
    idkitResponse?: Record<string, unknown>;
    signal?: string;
    signal_token?: string;
  };

  const walletAddress = input.walletAddress?.trim();
  const linkToken = input.linkToken?.trim();
  if (!walletAddress || !linkToken || !isAddress(walletAddress)) {
    json(400, { error: "walletAddress and linkToken are required" });
    return true;
  }

  const expectedSignal = changePayoutSignal(walletAddress);
  if (input.signal !== expectedSignal) {
    json(400, { error: "Selfie Check signal does not match the new payout address" });
    return true;
  }

  const linked = await findLinkedWallet(walletAddress, linkToken);
  if (!linked) {
    json(403, { error: "Wallet link expired or invalid — connect the new wallet and sign again" });
    return true;
  }

  if (!input.idkitResponse || !input.signal || !input.signal_token) {
    json(400, { error: "Selfie Check proof required" });
    return true;
  }

  const proof = await verifySelfieCheck({
    rpId: input.rp_id ?? requireEnv("WORLD_RP_ID"),
    idkitResponse: input.idkitResponse,
    signal: input.signal,
    signalToken: input.signal_token,
  });
  if (!proof.ok) {
    json(proof.status, { error: proof.error, detail: proof.detail });
    return true;
  }

  const worker = await findWorkerByNullifier(proof.nullifierHash);
  if (!worker) {
    json(403, { error: "No registered worker for this World ID — place a bid first" });
    return true;
  }

  const newAddress = walletAddress.toLowerCase();
  if (worker.address.toLowerCase() === newAddress) {
    json(400, { error: "New payout address is the same as your current one" });
    return true;
  }

  const taken = await findWorkerByAddress(newAddress);
  if (taken && taken.nullifierHash !== worker.nullifierHash) {
    json(409, { error: "This wallet is already bound to a different World ID" });
    return true;
  }

  await updateWorkerAddress(worker.nullifierHash, newAddress);
  await deleteLinkedWallet(newAddress);

  console.log(
    `[worker] payout address updated for ${worker.nullifierHash.slice(0, 10)}… → ${newAddress}`,
  );

  json(200, {
    walletAddress: newAddress,
    nullifierHash: worker.nullifierHash,
    previousAddress: worker.address,
  });
  return true;
}
