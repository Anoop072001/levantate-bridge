import { createCircleClient } from "../circle/client.js";
import { requireEnv } from "../env.js";
import { generateAgentApiKey, hashAgentApiKey } from "../auth/agent.js";
import { insertAgent, type AgentRecord } from "../store.js";

const FAUCET_URL = "https://faucet.circle.com";

export async function registerAgent(name?: string): Promise<{
  apiKey: string;
  agent: AgentRecord;
  faucetUrl: string;
}> {
  const walletSetId = requireEnv("CIRCLE_WALLET_SET_ID");
  const client = createCircleClient();
  const walletsResponse = await client.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "EOA",
  });
  const wallet = walletsResponse.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle wallet creation failed");
  }

  const apiKey = generateAgentApiKey();
  const agent = await insertAgent({
    apiKeyHash: hashAgentApiKey(apiKey),
    circleWalletId: wallet.id,
    address: wallet.address,
    name: name?.trim() || "agent",
  });

  return { apiKey, agent, faucetUrl: FAUCET_URL };
}
