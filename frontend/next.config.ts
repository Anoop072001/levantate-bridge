import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { resolve } from "node:path";

loadEnvConfig(resolve(import.meta.dirname, ".."));

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
