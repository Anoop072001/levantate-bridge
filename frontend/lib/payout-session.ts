import type { WorkerSession } from "./types";

/** Session is unusable for bidding — missing payout address or wrong wallet connected. */
export function isStalePayoutSession(
  session: WorkerSession | null,
  connectedAddress?: string,
): boolean {
  if (!session) return false;
  if (!session.walletAddress) return true;
  if (
    connectedAddress &&
    session.walletAddress.toLowerCase() !== connectedAddress.toLowerCase()
  ) {
    return true;
  }
  return false;
}

/** True when the worker can run Selfie Check without burning a proof on a wallet error. */
export function isPayoutReady(
  session: WorkerSession | null,
  connectedAddress?: string,
): boolean {
  if (!session?.walletAddress) return false;
  if (isStalePayoutSession(session, connectedAddress)) return false;
  return Boolean(session.linkToken || session.nullifierHash);
}

export function payoutSessionLabel(session: WorkerSession | null): string {
  if (!session?.walletAddress) return "Not linked";
  if (session.nullifierHash) return "Registered worker";
  if (session.linkToken) return "Payout linked — bid with Selfie Check";
  return "Incomplete — sign again to link";
}
