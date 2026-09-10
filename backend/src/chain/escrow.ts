import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, fallback, getContract, http, type PublicClient } from "viem";
import { arcTestnet } from "viem/chains";
import { loadRootEnv, requireEnv } from "../env.js";
import { getArcRpcUrls } from "./rpc-url.js";
import taskEscrowArtifact from "../../abi/TaskEscrow.json" with { type: "json" };

loadRootEnv();

const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;

export function createArcPublicClient(): PublicClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback(
      getArcRpcUrls().map((url) =>
        http(url, {
          timeout: 15_000,
          retryCount: 2,
          retryDelay: 750,
        }),
      ),
      { rank: false },
    ),
  });
}

export function getEscrowAddress(): `0x${string}` {
  return requireEnv("ESCROW_CONTRACT_ADDRESS") as `0x${string}`;
}

export function getEscrowContract(client: PublicClient = createArcPublicClient()) {
  return getContract({
    address: getEscrowAddress(),
    abi: taskEscrowArtifact.abi,
    client,
  });
}

export function getUsdcAddress(): `0x${string}` {
  return ARC_USDC;
}

export { taskEscrowArtifact };
