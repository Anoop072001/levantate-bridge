import { loadRootEnv } from "../src/env.js";
import { reconcileSubmittedTransactions } from "../src/confirmation/reconciler.js";
import { listSubmittedRelayedTransactions } from "../src/store.js";

loadRootEnv();

const before = listSubmittedRelayedTransactions();
console.log(`Submitted before: ${before.length}`);
for (const tx of before) {
  console.log(`  ${tx.id.slice(0, 8)}… ${tx.kind} ${tx.expectedEvent} ${tx.txHash ?? "no hash"}`);
}

await reconcileSubmittedTransactions();

const after = listSubmittedRelayedTransactions();
console.log(`Submitted after: ${after.length}`);
for (const tx of after) {
  console.log(`  still pending: ${tx.id.slice(0, 8)}… ${tx.kind}`);
}
