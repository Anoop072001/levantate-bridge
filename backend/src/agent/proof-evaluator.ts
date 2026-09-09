import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface ProofVerdict {
  approved: boolean;
  reason: string;
}

const EVAL_PROMPT = (taskDescription: string, proofContent: string) =>
  `You are evaluating work submitted for a paid task on a human task marketplace.

Task description:
${taskDescription}

Submitted proof:
${proofContent}

Decide whether this proof adequately completes the task. For the demo task "collect and summarize complaints from residents in this neighborhood", acceptable proof is free text summarizing complaints plus an optional link.

Respond with exactly two lines:
VERDICT: APPROVE or REJECT
REASON: one sentence explaining why`;

function parseVerdict(text: string): ProofVerdict {
  const approved = /VERDICT:\s*APPROVE/i.test(text);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  return { approved, reason: reasonMatch?.[1]?.trim() ?? text.trim() };
}

export function isProofEvaluationAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

async function evaluateWithAnthropic(taskDescription: string, proofContent: string): Promise<ProofVerdict> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [{ role: "user", content: EVAL_PROMPT(taskDescription, proofContent) }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  return parseVerdict(text);
}

async function evaluateWithOpenAI(taskDescription: string, proofContent: string): Promise<ProofVerdict> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 512,
    messages: [{ role: "user", content: EVAL_PROMPT(taskDescription, proofContent) }],
  });
  const text = response.choices[0]?.message?.content ?? "";
  return parseVerdict(text);
}

export async function evaluateProof(
  taskDescription: string,
  proofContent: string,
): Promise<ProofVerdict> {
  if (process.env.ANTHROPIC_API_KEY) {
    return evaluateWithAnthropic(taskDescription, proofContent);
  }
  if (process.env.OPENAI_API_KEY) {
    return evaluateWithOpenAI(taskDescription, proofContent);
  }
  throw new Error("Proof evaluation requires ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local");
}
