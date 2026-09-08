import { createCircleClient } from "../src/circle/client.js";
import { loadRootEnv, requireEnv, upsertRootEnv } from "../src/env.js";

loadRootEnv();

async function main() {
  const existing = process.env.CIRCLE_RELAYER_WALLET_ID;
  if (existing) {
    const client = createCircleClient();
    const wallet = await client.getWallet({ id: existing });
    const w = wallet.data?.wallet;
    console.log("Relayer wallet already configured:", existing, w?.address);
    return;
  }

  const client = createCircleClient();
  const walletSetId = requireEnv("CIRCLE_WALLET_SET_ID");

  const response = await client.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "EOA",
  });

  const relayer = response.data?.wallets?.[0];
  if (!relayer?.id || !relayer.address) {
    throw new Error("Relayer wallet creation failed");
  }

  upsertRootEnv({
    CIRCLE_RELAYER_WALLET_ID: relayer.id,
    CIRCLE_RELAYER_WALLET_ADDRESS: relayer.address,
  });

  console.log("Created relayer wallet:", relayer.id, relayer.address);
  console.log("Fund with testnet USDC from https://faucet.circle.com (Arc Testnet)");
  console.log("Redeploy escrow with DEPLOYER_AGENT_ADDRESS and DEPLOYER_RELAYER_ADDRESS set to Circle wallet addresses.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
