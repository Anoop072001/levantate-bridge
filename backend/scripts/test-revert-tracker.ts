import { loadRootEnv, requireEnv } from "../src/env.js";
import { getEscrowAddress } from "../src/chain/escrow.js";
import { reconcileSubmittedTransactions } from "../src/confirmation/reconciler.js";
import { enqueueContractCall } from "../src/relayer/submit.js";
import { getRelayedTransaction } from "../src/store.js";

loadRootEnv();

const taskId = 0;
const worker = "0x00000000000000000000000000000000000000dEaD";
const overBudget = 2_000_000;

const tx = await enqueueContractCall({
  walletId: requireEnv("CIRCLE_RELAYER_WALLET_ID"),
  kind: "place_bid_over_budget_test",
  expectedEvent: "BidPlaced",
  contractAddress: getEscrowAddress(),
  abiFunctionSignature: "placeBid(uint256,address,uint256)",
  abiParameters: [taskId, worker, overBudget.toString()],
  taskId,
  round: 0,
  worker,
});

console.log("Submitted:", tx.id, tx.status, tx.txHash);

for (let i = 0; i < 30; i++) {
  await reconcileSubmittedTransactions();
  const current = getRelayedTransaction(tx.id)!;
  console.log(`poll ${i + 1}: ${current.status}${current.error ? ` (${current.error})` : ""}`);
  if (current.status === "failed" || current.status === "confirmed") break;
  await new Promise((r) => setTimeout(r, 5000));
}

const final = getRelayedTransaction(tx.id)!;
if (final.status !== "failed") {
  console.error("Expected failed status for over-budget bid");
  process.exit(1);
}
console.log("Over-budget bid correctly marked failed");
