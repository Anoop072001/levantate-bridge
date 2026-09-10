export interface ProofVerdict {
  approved: boolean;
  reason: string;
}

const EVAL_PROMPT = (
  taskDescription: string,
  proofContent: string,
  submissionKind: "text" | "file" = "text",
) =>
  `You are evaluating work submitted for a paid task on a human task marketplace.

Task description:
${taskDescription}

Submission format: ${submissionKind === "file" ? "file upload (content extracted below)" : "written text"}

Submitted proof:
${proofContent}

Decide whether this proof adequately completes the task. Workers may submit either written text or a file (PDF, Word, Excel, CSV, plain text). Judge the substance — summaries, data, or documents that fulfill the task description should be approved even when the format differs from the example.

For the demo task "collect and summarize complaints from residents in this neighborhood", acceptable proof is a written summary, a PDF/Word report, or a spreadsheet listing complaints.

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

async function evaluateWithAnthropic(
  taskDescription: string,
  proofContent: string,
  submissionKind: "text" | "file",
): Promise<ProofVerdict> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [{ role: "user", content: EVAL_PROMPT(taskDescription, proofContent, submissionKind) }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  return parseVerdict(text);
}

async function evaluateWithOpenAI(
  taskDescription: string,
  proofContent: string,
  submissionKind: "text" | "file",
): Promise<ProofVerdict> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 512,
    messages: [{ role: "user", content: EVAL_PROMPT(taskDescription, proofContent, submissionKind) }],
  });
  const text = response.choices[0]?.message?.content ?? "";
  return parseVerdict(text);
}

export async function evaluateProof(
  taskDescription: string,
  proofContent: string,
  submissionKind: "text" | "file" = "text",
): Promise<ProofVerdict> {
  if (process.env.ANTHROPIC_API_KEY) {
    return evaluateWithAnthropic(taskDescription, proofContent, submissionKind);
  }
  if (process.env.OPENAI_API_KEY) {
    return evaluateWithOpenAI(taskDescription, proofContent, submissionKind);
  }
  throw new Error("Proof evaluation requires ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local");
}
