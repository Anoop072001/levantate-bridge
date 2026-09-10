import { backendUrl } from "./config";
import { getRegisteredNullifier } from "./registered-nullifier";
import { getWorkerSession, setWorkerSession } from "./worker-session";
import type { WorkerSession } from "./types";

export async function linkPayoutWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<WorkerSession> {
  const existing = getWorkerSession();
  const knownNullifier = existing?.nullifierHash ?? getRegisteredNullifier() ?? undefined;
  if (
    existing?.nullifierHash &&
    existing.walletAddress.toLowerCase() !== address.toLowerCase()
  ) {
    throw new Error(
      "This World ID is already registered to a different payout address. Use Change payout wallet (sign + Selfie Check) — signing here does not update your registration.",
    );
  }
  const challengeRes = await fetch(`${backendUrl}/api/wallet/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const challenge = (await challengeRes.json()) as {
    challengeToken?: string;
    message?: string;
    error?: string;
  };
  if (!challengeRes.ok || !challenge.challengeToken || !challenge.message) {
    throw new Error(challenge.error ?? "Could not start wallet verification");
  }

  const signature = await signMessage(challenge.message);

  const linkRes = await fetch(`${backendUrl}/api/wallet/link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address,
      signature,
      challengeToken: challenge.challengeToken,
    }),
  });
  const linked = (await linkRes.json()) as {
    walletAddress?: string;
    nullifierHash?: string;
    linkToken?: string;
    error?: string;
  };
  if (!linkRes.ok || !linked.walletAddress) {
    throw new Error(linked.error ?? "Could not link wallet");
  }

  const session: WorkerSession = {
    walletAddress: linked.walletAddress,
    nullifierHash: linked.nullifierHash ?? existing?.nullifierHash ?? knownNullifier,
    linkToken: linked.linkToken,
  };
  setWorkerSession(session);
  return session;
}
