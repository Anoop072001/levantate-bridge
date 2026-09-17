import { createCircleClient } from "../src/circle/client.js";
import { loadRootEnv, upsertRootEnv } from "../src/env.js";

loadRootEnv();

async function main() {
  const existingSetId = process.env.CIRCLE_WALLET_SET_ID;

  if (existingSetId) {
    console.log("Wallet set already configured:", existingSetId);
    console.log("Register an agent wallet via POST /api/agents/register (or MCP OAuth sign-in).");
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
  upsertRootEnv({ CIRCLE_WALLET_SET_ID: walletSetId });
  console.log("Register agents with POST /api/agents/register — each gets its own Circle wallet on Arc.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
