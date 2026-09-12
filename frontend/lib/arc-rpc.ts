import { http } from "viem";
import { backendUrl } from "./config";

export const DEFAULT_ARC_RPC_URL = "https://rpc.testnet.arc.io";

/**
 * Browser wagmi reads go through the backend proxy so DevTools does not hit Arc RPC directly
 * (avoids blocked:other from CORS, ad blockers, and third-party RPC domain filters).
 * Task state itself is loaded via The Graph on the backend — not through this transport.
 */
export function getArcRpcUrl(): string {
  if (typeof window !== "undefined") {
    return `${backendUrl}/api/rpc`;
  }

  const fromEnv = process.env.NEXT_PUBLIC_ARC_RPC_URLS?.trim();
  if (fromEnv) {
    const first = fromEnv.split(",").map((s) => s.trim()).find(Boolean);
    if (first) return first;
  }
  const single = process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim();
  if (single) return single;
  return DEFAULT_ARC_RPC_URL;
}

export function createArcHttpTransport() {
  return http(getArcRpcUrl(), {
    timeout: 15_000,
    retryCount: 1,
    retryDelay: 750,
  });
}
