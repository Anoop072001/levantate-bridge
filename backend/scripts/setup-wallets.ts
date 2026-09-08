import { createCircleClient } from "../src/circle/client.js";
import { loadRootEnv, requireEnv, upsertRootEnv } from "../src/env.js";

loadRootEnv();

const ARC_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  const existingSetId = process.env.CIRCLE_WALLET_SET_ID;
  const existingAgentId = process.env.CIRCLE_AGENT_WALLET_ID;

  if (existingSetId && existingAgentId) {
    const client = createCircleClient();
    const wallet = await client.getWallet({ id: existingAgentId });
    const w = wallet.data?.wallet;
    console.log("Wallet set already configured:", existingSetId);
    console.log("Agent wallet:", w?.id, w?.address, w?.blockchain);
    return;
  }

  const client = createCircleClient();

  const walletSetResponse = await client.createWalletSet({
    name: "Levantate Bridge",
  });
  const walletSetId = walletSetResponse.data?.walletSet?.id;
  if (!walletSetId) {
    throw new Error("Wallet set creation failed: no ID returned");
  }
  console.log("Created wallet set:", walletSetId);

  const walletsResponse = await client.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "EOA",
  });
  const agent = walletsResponse.data?.wallets?.[0];
  if (!agent?.id || !agent.address) {
    throw new Error("Agent wallet creation failed");
  }
  console.log("Created agent wallet:", agent.id, agent.address);

  upsertRootEnv({
    CIRCLE_WALLET_SET_ID: walletSetId,
    CIRCLE_AGENT_WALLET_ID: agent.id,
    CIRCLE_AGENT_WALLET_ADDRESS: agent.address,
  });

  console.log("\nFund the agent wallet with testnet USDC:");
  console.log("  https://faucet.circle.com (Arc Testnet)");
  console.log("  Address:", agent.address);
  console.log("  USDC contract:", ARC_USDC);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
