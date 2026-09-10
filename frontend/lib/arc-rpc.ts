import { fallback, http } from "viem";

export const DEFAULT_ARC_RPC_URLS = [
  "https://rpc.testnet.arc.io",
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.quicknode.testnet.arc.io",
] as const;

export function getArcRpcUrls(): string[] {
  const fromEnv = process.env.NEXT_PUBLIC_ARC_RPC_URLS?.trim();
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const single = process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim();
  if (single) return [single];
  return [...DEFAULT_ARC_RPC_URLS];
}

export function createArcHttpTransport() {
  return fallback(
    getArcRpcUrls().map((url) =>
      http(url, {
        timeout: 15_000,
        retryCount: 2,
        retryDelay: 750,
      }),
    ),
    { rank: false },
  );
}
