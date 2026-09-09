import { loadRootEnv } from "../src/env.js";
import { deriveTaskParams } from "../src/agent/budget.js";
import { fetchHistoricalPayments } from "../src/agent/queries.js";

loadRootEnv();

const params = await deriveTaskParams();
const payments = await fetchHistoricalPayments();

console.log("Agent budget params:", {
  maxBudget: params.maxBudget.toString(),
  submissionWindow: params.submissionWindow.toString(),
  reasoning: params.reasoning,
});
console.log(`Historical payments: ${payments.length}`);
