import { createCircleClient } from "./client.js";
import { requireEnv } from "../env.js";

export async function createWorkerWallet(nullifierHash: string) {
  const client = createCircleClient();
  const walletSetId = requireEnv("CIRCLE_WALLET_SET_ID");

  const response = await client.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "EOA",
    metadata: [{ name: "Levantate worker", refId: nullifierHash.slice(0, 36) }],
  });

  const wallet = response.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) {
    throw new Error("Worker wallet creation failed");
  }
  return { walletId: wallet.id, address: wallet.address };
}
