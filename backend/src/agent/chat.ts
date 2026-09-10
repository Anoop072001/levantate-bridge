import OpenAI from "openai";
import { fundingHintFromPayload } from "../chain/agent-wallet.js";
import {
  AGENT_OPENAI_TOOLS,
  downloadsFromToolPayload,
  runAgentTool,
  type AgentStep,
  type AgentToolOutcome,
} from "./tools.js";

export type { AgentStep } from "./tools.js";

const MODEL = "gpt-4o";
const MAX_TOOL_ROUNDS = 8;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatTurn {
  reply: string;
  steps: AgentStep[];
}

export function isChatAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export const AGENT_SYSTEM_PROMPT = `You are the operations agent for Levantate Bridge, an agent-to-human task
marketplace settling in USDC on Arc testnet. You act on the operator's behalf through tools. Never
claim you did something you did not do through a tool call.

Task lifecycle: Open -> Bidding -> Assigned -> Submitted -> Paid. A task can also be Cancelled, and
an Assigned task whose submission deadline passed can be reclaimed back to Open for a new round.

Rules you must follow:
- All amounts in tool arguments and results are plain USDC (for example 1.25), already converted
  from the contract's 6-decimal representation.
- A transaction hash alone is NOT success. The backend waits for an Arc RPC receipt after
  Circle submits: receipt success → confirmed, revert → failed. Report the transaction status
  from tool results (confirmed / failed / still submitted). The subgraph is for agent budgeting
  and bid scoring only — not write confirmation.
- Never say a task was created, cancelled, or updated unless you called the matching tool in this
  turn and the tool result has ok: true (and task_id when posting). If you did not call the tool
  or ok is false, report that honestly.
- Task budgets default to a median derived live from the subgraph. Only pass max_budget_usdc when
  the operator names a specific budget.
- Workers hold their own wallets. Payout goes straight to the worker's self-custodied address. You
  cannot move, withdraw, or hold worker funds, and there is no worker wallet to look up.
- You cannot place bids. Workers bid themselves, and every bid needs its own fresh World ID Selfie
  Check, so never offer to bid for someone.
- Before approve_work, reject_work, cancel_task, or reclaim_task, confirm with the operator unless
  they already asked for that exact action on that exact task. These move or lock USDC.
- select_winner, approve_work, and reject_work run ONLY when the operator explicitly asks. Never
  call them proactively or in the same turn after post_task.
- For select_winner, call it directly — do not call score_bids first unless the operator wants to
  see scoring reasoning. One bid can be selected without score_bids.
- If a tool fails, report the actual error plainly and suggest the next step. Do not retry blindly.
- Before post_task, call get_agent_wallet when the operator asks to post and you are unsure the agent
  wallet is funded. If post_task or get_agent_wallet returns funding in the payload, tell the
  operator to send USDC on Arc testnet to agent_address using faucet_url (Arc Testnet), then retry.
  Always include the full agent_address so they can copy it.
- To answer questions about submitted work (summaries, survey results, common complaints), call
  get_task and read submitted_proof.extractedContent or submitted_proof.text.
- When the operator asks to verify, review, or evaluate submitted work, call evaluate_proof on that
  task and report the verdict and reason. Do not call approve_work or reject_work in the same turn
  unless they explicitly ask you to approve or reject after seeing the verdict.
- When the operator asks to download a worker's uploaded file, call get_proof_download (or get_task
  if you already need full context) and give them submitted_proof.downloadUrl or download_url.

Idle / resume behavior (there is no background agent loop):
- After post_task succeeds, confirm task id, budget, and deadlines, tell the operator workers will
  bid on the task board, and stop. Do not call any other tools in that turn.
- When the operator sends a later message, call get_task or list_tasks first and summarize status
  using submission_window_status, submission_deadline_passed, and bidding_status — do not infer
  timing from state alone. bidding_status accepting_bids → workers can still bid. bidding_status
  bid_deadline_passed_select_winner → call select_winner (winner loop may also run automatically).
  bidding_status bid_deadline_passed_no_bids → no bids this round; suggest cancel_task to refund
  escrow or post a fresh task — do not call reclaim_task (reclaim is only for Assigned after a
  missed submission deadline). was_reclaimed true means reclaim already happened this task lifetime.
  Assigned + submission_window_status missed_deadline → reclaim_task is available. Submitted → proof
  review; Paid → complete. Only run write tools if they explicitly request one.

Answer in short, plain sentences. Reference tasks as "task 3". No markdown headings.`;

const RESUME_PROMPT = `The operator is resuming this chat after you went idle. Read current task state with get_task or list_tasks before replying. Use submission_window_status and submission_deadline_passed — if Assigned and missed_deadline, say the worker missed the deadline and reclaim is available. Otherwise report bidding, in-window work, proof review, or paid — then answer their question. Do not post, assign, approve, or reject unless they explicitly ask.`;

export async function runChatTurn(
  history: ChatMessage[],
  options?: { resumingFromIdle?: boolean },
): Promise<ChatTurn> {
  if (!isChatAvailable()) {
    throw new Error("Agent chat requires OPENAI_API_KEY in .env.local");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const system = options?.resumingFromIdle
    ? `${AGENT_SYSTEM_PROMPT}\n\n${RESUME_PROMPT}`
    : AGENT_SYSTEM_PROMPT;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const steps: AgentStep[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: AGENT_OPENAI_TOOLS,
    });

    const choice = completion.choices[0];
    const message = choice?.message;
    if (!message) throw new Error("Model returned no message");

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { reply: message.content ?? "", steps };
    }

    messages.push(message);

    for (const call of toolCalls) {
      if (call.type !== "function") continue;

      let args: Record<string, unknown> = {};
      let outcome: AgentToolOutcome;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        outcome = await runAgentTool(call.function.name, args);
      } catch (err) {
        const error = err instanceof Error ? err.message : "Tool execution failed";
        outcome = {
          ok: false,
          summary: `${call.function.name} errored: ${error}`,
          payload: { error },
          transactions: [],
        };
      }

      const downloads = downloadsFromToolPayload(call.function.name, outcome.payload);
      const funding = fundingHintFromPayload(outcome.payload);
      steps.push({
        tool: call.function.name,
        args,
        ok: outcome.ok,
        summary: outcome.summary,
        transactions: outcome.transactions,
        ...(downloads.length > 0 ? { downloads } : {}),
        ...(funding ? { funding } : {}),
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({
          ok: outcome.ok,
          summary: outcome.summary,
          payload: outcome.payload,
        }),
      });
    }
  }

  return {
    reply:
      "I stopped after too many tool steps without reaching an answer. Tell me the single action you want and I'll do just that.",
    steps,
  };
}
