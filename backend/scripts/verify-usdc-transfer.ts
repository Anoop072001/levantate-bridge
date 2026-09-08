import { randomUUID } from "node:crypto";
import { createPublicClient, erc20Abi, http } from "viem";
import { arcTestnet } from "viem/chains";
import { createCircleClient } from "../src/circle/client.js";
import { loadRootEnv, requireEnv } from "../src/env.js";

loadRootEnv();

const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
const TRANSFER_AMOUNT = 100_000n; // 0.1 USDC (6 decimals)

async function waitForTx(client: ReturnType<typeof createCircleClient>, txId: string) {
  for (let i = 0; i < 60; i++) {
    const res = await client.getTransaction({ id: txId });
    const state = res.data?.transaction?.state;
    const hash = res.data?.transaction?.txHash;
    if (state === "COMPLETE" && hash) return hash;
    if (state === "FAILED") {
      throw new Error(`Circle transaction ${txId} failed`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for Circle transaction ${txId}`);
}

async function main() {
  const agentWalletId = requireEnv("CIRCLE_AGENT_WALLET_ID");
  const recipient =
    process.env.CIRCLE_TRANSFER_RECIPIENT ??
    "0xC95ca8b8610A99314D27a923E580109FFeC4b3D1";
  const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl),
  });

  const balanceBefore = await publicClient.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipient as `0x${string}`],
  });

  const circle = createCircleClient();
  const response = await circle.createContractExecutionTransaction({
    walletId: agentWalletId,
    contractAddress: ARC_USDC,
    abiFunctionSignature: "transfer(address,uint256)",
    abiParameters: [recipient, TRANSFER_AMOUNT.toString()],
    idempotencyKey: randomUUID(),
    fee: { type: "level", config: { feeLevel: "LOW" } },
  });

  const txId = response.data?.id;
  if (!txId) {
    throw new Error("No transaction ID returned from Circle");
  }
  console.log("Submitted USDC transfer, Circle tx id:", txId);

  const txHash = await waitForTx(circle, txId);
  console.log("On-chain tx hash:", txHash);

  const balanceAfter = await publicClient.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipient as `0x${string}`],
  });

  const delta = balanceAfter - balanceBefore;
  if (delta !== TRANSFER_AMOUNT) {
    throw new Error(`Expected recipient balance +${TRANSFER_AMOUNT}, got +${delta}`);
  }

  console.log("USDC transfer verified: recipient received 0.1 USDC");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
