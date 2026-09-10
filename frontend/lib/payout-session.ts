import type { WorkerSession } from "./types";

export interface RegisteredPayout {
  registeredAddress: string;
  nullifierHash: string;
}

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

/** Registered worker is connected/signed to a wallet other than their on-chain payout address. */
export function needsPayoutChange(
  registeredPayout: RegisteredPayout | null | undefined,
  connectedAddress?: string,
  session?: WorkerSession | null,
): boolean {
  if (!registeredPayout) return false;
  const registered = registeredPayout.registeredAddress.toLowerCase();
  if (connectedAddress && connectedAddress.toLowerCase() !== registered) return true;
  if (session?.walletAddress && session.walletAddress.toLowerCase() !== registered) return true;
  return false;
}

/** True when the worker can run bid Selfie Check without a wallet/registration mismatch. */
export function isPayoutReady(
  session: WorkerSession | null,
  connectedAddress?: string,
  registeredPayout?: RegisteredPayout | null,
): boolean {
  if (registeredPayout) {
    const registered = registeredPayout.registeredAddress.toLowerCase();
    if (!connectedAddress || connectedAddress.toLowerCase() !== registered) return false;
    if (!session?.walletAddress || session.walletAddress.toLowerCase() !== registered) return false;
    return true;
  }

  if (!session?.walletAddress) return false;
  if (isStalePayoutSession(session, connectedAddress)) return false;
  return Boolean(session.linkToken);
}

export function payoutSessionLabel(
  session: WorkerSession | null,
  registeredPayout?: RegisteredPayout | null,
): string {
  if (needsPayoutChange(registeredPayout, session?.walletAddress, session)) {
    return "Registered — update payout wallet to bid";
  }
  if (!session?.walletAddress) {
    return registeredPayout ? "Registered worker — link payout wallet" : "Not linked";
  }
  if (session.nullifierHash || registeredPayout) return "Registered worker";
  if (session.linkToken) return "Payout linked — bid with Selfie Check";
  return "Incomplete — sign again to link";
}
