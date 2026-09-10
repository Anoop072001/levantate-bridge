import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { resolve } from "node:path";

// AGENTS.md: single root .env.local — load it before Next reads env for the client bundle
const repoRoot = resolve(import.meta.dirname, "..");
loadEnvConfig(repoRoot);

const DEFAULT_ARC_RPC_URLS =
  "https://rpc.testnet.arc.io,https://rpc.blockdaemon.testnet.arc.io,https://rpc.drpc.testnet.arc.io,https://rpc.quicknode.testnet.arc.io";

const x402Stubs: Record<string, string> = {
  "@base-org/account": "./lib/base-org-account-stub.ts",
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001",
    NEXT_PUBLIC_WORLD_APP_ID:
      process.env.NEXT_PUBLIC_WORLD_APP_ID ?? process.env.WORLD_APP_ID ?? "",
    NEXT_PUBLIC_WORLD_RP_ID:
      process.env.NEXT_PUBLIC_WORLD_RP_ID ?? process.env.WORLD_RP_ID ?? "",
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
    NEXT_PUBLIC_ARC_RPC_URLS: process.env.ARC_RPC_URL ?? DEFAULT_ARC_RPC_URLS,
  },
  // RainbowKit's main bundle imports Coinbase Base Account, which dynamically
  // requires optional x402/Solana clients we do not use on Arc.
  turbopack: {
    resolveAlias: x402Stubs,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(
        Object.entries(x402Stubs).map(([pkg, rel]) => [pkg, resolve(import.meta.dirname, rel)]),
      ),
    };
    return config;
  },
};

export default nextConfig;
