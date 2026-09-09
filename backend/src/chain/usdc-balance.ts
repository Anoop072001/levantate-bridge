import type { PublicClient } from "viem";
import { createArcPublicClient, getUsdcAddress } from "./escrow.js";

export async function readUsdcBalance(
  address: `0x${string}`,
  client: PublicClient = createArcPublicClient(),
): Promise<bigint> {
  return client.readContract({
    address: getUsdcAddress(),
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [address],
  }) as Promise<bigint>;
}
