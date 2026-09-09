import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { resolve } from "node:path";

// AGENTS.md: single root .env.local — load it before Next reads env for the client bundle
const repoRoot = resolve(import.meta.dirname, "..");
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001",
    NEXT_PUBLIC_WORLD_APP_ID:
      process.env.NEXT_PUBLIC_WORLD_APP_ID ?? process.env.WORLD_APP_ID ?? "",
    NEXT_PUBLIC_WORLD_RP_ID:
      process.env.NEXT_PUBLIC_WORLD_RP_ID ?? process.env.WORLD_RP_ID ?? "",
  },
};

export default nextConfig;
