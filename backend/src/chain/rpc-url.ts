/** Default Arc testnet RPC — single endpoint; set ARC_RPC_URL for an explicit override or comma-separated failover list. */
export const DEFAULT_ARC_RPC_URLS = ["https://rpc.testnet.arc.io"] as const;

/** Comma-separated override via ARC_RPC_URL, else the default quartet. */
export function getArcRpcUrls(): string[] {
  const explicit = process.env.ARC_RPC_URL?.trim();
  if (explicit) {
    return explicit
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...DEFAULT_ARC_RPC_URLS];
}

export function getArcRpcUrl(): string {
  return getArcRpcUrls()[0]!;
}
