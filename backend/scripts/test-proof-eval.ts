import { loadRootEnv } from "../src/env.js";
import { evaluateProof, isProofEvaluationAvailable } from "../src/agent/proof-evaluator.js";

loadRootEnv();

if (!isProofEvaluationAvailable()) {
  console.error("No LLM API key configured");
  process.exit(1);
}

const good = await evaluateProof(
  "Collect and summarize complaints from residents in this neighborhood",
  "Residents report broken streetlights on Oak Ave, loud construction after 10pm, and missed trash pickup on Tuesdays.",
);
console.log("Good proof:", good);

const bad = await evaluateProof(
  "Collect and summarize complaints from residents in this neighborhood",
  "asdf",
);
console.log("Bad proof:", bad);
