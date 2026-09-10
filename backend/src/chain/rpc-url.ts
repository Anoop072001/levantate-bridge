/** Public Arc testnet RPC endpoints — viem fallback tries each in order. */
export const DEFAULT_ARC_RPC_URLS = [
  "https://rpc.testnet.arc.io",
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.quicknode.testnet.arc.io",
] as const;

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
