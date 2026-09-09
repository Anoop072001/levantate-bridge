import OpenAI from "openai";
import { createArcPublicClient } from "../chain/escrow.js";
import { enrichTask } from "../chain/task-view.js";
import { transactionResponse } from "../relayer/submit.js";
import {
  getProof,
  getRelayedTransaction,
  getTask,
  listBidsForTask,
  listTasks,
  type RelayedTransaction,
} from "../store.js";
import {
  approveWork,
  cancelTask,
  postTask,
  reclaimTask,
  rejectWork,
  selectWinner,
} from "./operations.js";
import { scoreBids } from "./score-bids.js";

const MODEL = "gpt-4o";
const MAX_TOOL_ROUNDS = 8;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  /** Relayed transactions this step produced, so the UI can track them to confirmation (D6). */
  transactions: ReturnType<typeof transactionResponse>[];
}

export interface ChatTurn {
  reply: string;
  steps: AgentStep[];
}

export function isChatAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

const SYSTEM_PROMPT = `You are the operations agent for Levantate Bridge, an agent-to-human task
marketplace settling in USDC on Arc testnet. You act on the operator's behalf through tools. Never
claim you did something you did not do through a tool call.

Task lifecycle: Open -> Bidding -> Assigned -> Submitted -> Paid. A task can also be Cancelled, and
an Assigned task whose submission deadline passed can be reclaimed back to Open for a new round.

Rules you must follow:
- All amounts in tool arguments and results are plain USDC (for example 1.25), already converted
  from the contract's 6-decimal representation.
- A transaction hash is NOT success. Every write returns a relayed transaction that stays pending
  until its event is indexed by the subgraph. Say "submitted, waiting for on-chain confirmation"
  and never announce a payment or cancellation as done. The operator can check with
  get_transaction.
- Task budgets default to a median derived live from the subgraph. Only pass max_budget_usdc when
  the operator names a specific budget.
- Workers hold their own wallets. Payout goes straight to the worker's self-custodied address. You
  cannot move, withdraw, or hold worker funds, and there is no worker wallet to look up.
- You cannot place bids. Workers bid themselves, and every bid needs its own fresh World ID Selfie
  Check, so never offer to bid for someone.
- Before approve_work, reject_work, cancel_task, or reclaim_task, confirm with the operator unless
  they already asked for that exact action on that exact task. These move or lock USDC.
- select_winner with no bid_id picks the winner by scoring bids against live subgraph history. Do
  that by default; use score_bids first if the operator wants to see the reasoning.
- If a tool fails, report the actual error plainly and suggest the next step. Do not retry blindly.

Answer in short, plain sentences. Reference tasks as "task 3". No markdown headings.`;

function usdc(micro: string | bigint): number {
  return Number(micro) / 1_000_000;
}

function toMicro(amountUsdc: number): string {
  return BigInt(Math.round(amountUsdc * 1_000_000)).toString();
}

function unixToIso(unix: string | bigint): string | null {
  const n = Number(unix);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List every task with its authoritative on-chain state, budget, round, deadlines, and bid count.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_task",
      description:
        "Full detail for one task: on-chain state, bids for the current round, and the submitted proof text when the task is Submitted.",
      parameters: {
        type: "object",
        properties: { task_id: { type: "integer" } },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "score_bids",
      description:
        "Score the current round's bids using live subgraph history (worker completion rate, missed deadlines, price fit) and return the recommended winner without assigning anything.",
      parameters: {
        type: "object",
        properties: { task_id: { type: "integer" } },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_task",
      description:
        "Escrow USDC and post a new task on-chain. Budget and submission window default to subgraph-derived medians when omitted.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "What the worker has to do." },
          bid_deadline_minutes: {
            type: "number",
            description: "How long bidding stays open, in minutes.",
          },
          submission_window_minutes: {
            type: "number",
            description: "How long the assigned worker gets to submit, in minutes. Omit to use the subgraph median.",
          },
          max_budget_usdc: {
            type: "number",
            description: "Maximum payout in USDC. Omit to use the subgraph median.",
          },
        },
        required: ["description", "bid_deadline_minutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_winner",
      description:
        "Assign a task to a bidder after the bid deadline. Omit bid_id to let subgraph-informed scoring pick the winner.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "integer" },
          bid_id: { type: "integer", description: "Optional explicit bid to accept." },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_work",
      description:
        "Approve submitted work, releasing escrowed USDC to the worker's own address. Requires state Submitted.",
      parameters: {
        type: "object",
        properties: { task_id: { type: "integer" } },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_work",
      description:
        "Reject submitted work. The task returns to Assigned with a refreshed submission deadline so the worker can resubmit.",
      parameters: {
        type: "object",
        properties: { task_id: { type: "integer" } },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reclaim_task",
      description:
        "Reopen bidding on an Assigned task whose submission deadline passed. Escrow stays locked and the defaulting worker is barred from re-bidding.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "integer" },
          new_bid_deadline_minutes: { type: "number" },
        },
        required: ["task_id", "new_bid_deadline_minutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_task",
      description:
        "Close an Open or Bidding task and refund the escrowed USDC to the agent wallet.",
      parameters: {
        type: "object",
        properties: { task_id: { type: "integer" } },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transaction",
      description:
        "Current status of a relayed transaction. Only 'confirmed' means the event was indexed by the subgraph.",
      parameters: {
        type: "object",
        properties: { transaction_id: { type: "string" } },
        required: ["transaction_id"],
      },
    },
  },
];

interface ToolOutcome {
  ok: boolean;
  summary: string;
  payload: unknown;
  transactions: RelayedTransaction[];
}

async function taskSummaries() {
  const client = createArcPublicClient();
  const stored = await listTasks();
  const enriched = await Promise.all(stored.map((t) => enrichTask(t, client)));
  return enriched.map((t) => ({
    task_id: t.id,
    description: t.description,
    state: t.stateLabel,
    round: t.round,
    max_budget_usdc: usdc(t.maxBudget),
    bid_deadline: unixToIso(t.bidDeadline),
    submission_deadline: unixToIso(t.submissionDeadline),
    bid_count_this_round: Number(t.currentRoundBidCount),
    assigned_worker: t.assignedWorker,
  }));
}

async function runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  switch (name) {
    case "list_tasks": {
      const tasks = await taskSummaries();
      return {
        ok: true,
        summary: `Read ${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
        payload: { tasks },
        transactions: [],
      };
    }

    case "get_task": {
      const taskId = Number(args.task_id);
      const stored = await getTask(taskId);
      if (!stored) {
        return { ok: false, summary: `Task ${taskId} not found`, payload: { error: "Task not found" }, transactions: [] };
      }
      const task = await enrichTask(stored);
      const bids = await listBidsForTask(taskId, task.round);
      const proof = task.state === 3 ? await getProof(taskId, task.round) : undefined;
      return {
        ok: true,
        summary: `Read task ${taskId} (${task.stateLabel})`,
        payload: {
          task_id: task.id,
          description: task.description,
          state: task.stateLabel,
          round: task.round,
          max_budget_usdc: usdc(task.maxBudget),
          bid_deadline: unixToIso(task.bidDeadline),
          submission_deadline: unixToIso(task.submissionDeadline),
          assigned_worker: task.assignedWorker,
          bids: bids.map((b) => ({
            bid_id: b.id,
            worker: b.workerAddress,
            amount_usdc: usdc(b.amount),
          })),
          submitted_proof: proof?.content ?? null,
        },
        transactions: [],
      };
    }

    case "score_bids": {
      const taskId = Number(args.task_id);
      const stored = await getTask(taskId);
      if (!stored) {
        return { ok: false, summary: `Task ${taskId} not found`, payload: { error: "Task not found" }, transactions: [] };
      }
      const task = await enrichTask(stored);
      const bids = await listBidsForTask(taskId, task.round);
      const selection = await scoreBids(bids, BigInt(task.maxBudget));
      return {
        ok: true,
        summary: `Scored ${bids.length} bid${bids.length === 1 ? "" : "s"} on task ${taskId}`,
        payload: {
          message: selection.reasoning.message,
          eligible_bid_count: selection.reasoning.eligibleBidCount,
          median_historical_paid_usdc: selection.reasoning.medianHistoricalPaid
            ? usdc(selection.reasoning.medianHistoricalPaid)
            : null,
          recommended: selection.winner
            ? {
                bid_id: selection.winner.bidId,
                worker: selection.winner.workerAddress,
                amount_usdc: usdc(selection.winner.amount),
                total_score: selection.winner.totalScore,
                worker_stats: selection.winner.workerStats,
              }
            : null,
          all_scores: selection.scores.map((s) => ({
            bid_id: s.bidId,
            worker: s.workerAddress,
            amount_usdc: usdc(s.amount),
            total_score: s.totalScore,
            missed_deadline_penalty: s.missedDeadlinePenalty,
          })),
        },
        transactions: [],
      };
    }

    case "post_task": {
      const result = await postTask({
        description: String(args.description ?? ""),
        bidDeadlineSeconds: Math.round(Number(args.bid_deadline_minutes) * 60),
        submissionWindowSeconds:
          args.submission_window_minutes === undefined
            ? undefined
            : Math.round(Number(args.submission_window_minutes) * 60),
        maxBudgetMicro:
          args.max_budget_usdc === undefined ? undefined : toMicro(Number(args.max_budget_usdc)),
      });
      if (!result.ok) {
        return {
          ok: false,
          summary: `post_task failed: ${result.error}`,
          payload: { error: result.error },
          transactions: result.transaction ? [result.transaction] : [],
        };
      }
      return {
        ok: true,
        summary: `Posted task ${result.task.taskId} at ${usdc(result.task.maxBudget)} USDC`,
        payload: {
          task_id: result.task.taskId,
          max_budget_usdc: usdc(result.task.maxBudget),
          bid_deadline: unixToIso(result.task.bidDeadline),
          submission_window_minutes: Number(result.task.submissionWindow) / 60,
          budget_source: result.task.budgetReasoning
            ? {
                subgraph_median_paid_usdc: result.task.budgetReasoning.medianPaidAmount
                  ? usdc(result.task.budgetReasoning.medianPaidAmount)
                  : null,
                used_defaults: result.task.budgetReasoning.usedDefaults,
              }
            : "explicit",
          status: "submitted, not yet confirmed on-chain",
        },
        transactions: result.task.transactions,
      };
    }

    case "select_winner": {
      const taskId = Number(args.task_id);
      const result = await selectWinner(
        taskId,
        args.bid_id === undefined ? undefined : Number(args.bid_id),
      );
      if (!result.ok) {
        return {
          ok: false,
          summary: `select_winner failed: ${result.error}`,
          payload: { error: result.error, scoring: result.selection?.reasoning.message ?? null },
          transactions: result.transaction ? [result.transaction] : [],
        };
      }
      return {
        ok: true,
        summary: `Assigned task ${taskId} to bid ${result.bidId}`,
        payload: {
          task_id: taskId,
          bid_id: result.bidId,
          worker: result.workerAddress,
          scoring: result.selection?.reasoning.message ?? "explicit bid id",
          status: "submitted, not yet confirmed on-chain",
        },
        transactions: [result.transaction],
      };
    }

    case "approve_work":
    case "reject_work": {
      const taskId = Number(args.task_id);
      const approve = name === "approve_work";
      const result = approve ? await approveWork(taskId) : await rejectWork(taskId);
      if (!result.ok) {
        return {
          ok: false,
          summary: `${name} failed: ${result.error}`,
          payload: { error: result.error },
          transactions: result.transaction ? [result.transaction] : [],
        };
      }
      return {
        ok: true,
        summary: approve ? `Approved task ${taskId}` : `Rejected work on task ${taskId}`,
        payload: {
          task_id: taskId,
          status: "submitted, not yet confirmed on-chain",
          note: approve
            ? "Payout lands in the worker's self-custodied wallet once PaymentReleased is indexed."
            : "Task returns to Assigned with a refreshed submission deadline once indexed.",
        },
        transactions: [result.transaction],
      };
    }

    case "reclaim_task": {
      const taskId = Number(args.task_id);
      const result = await reclaimTask(
        taskId,
        Math.round(Number(args.new_bid_deadline_minutes) * 60),
      );
      if (!result.ok) {
        return {
          ok: false,
          summary: `reclaim_task failed: ${result.error}`,
          payload: { error: result.error },
          transactions: result.transaction ? [result.transaction] : [],
        };
      }
      return {
        ok: true,
        summary: `Reclaimed task ${taskId} into round ${result.round}`,
        payload: { task_id: taskId, round: result.round, status: "submitted, not yet confirmed on-chain" },
        transactions: [result.transaction],
      };
    }

    case "cancel_task": {
      const taskId = Number(args.task_id);
      const result = await cancelTask(taskId);
      if (!result.ok) {
        return {
          ok: false,
          summary: `cancel_task failed: ${result.error}`,
          payload: { error: result.error },
          transactions: result.transaction ? [result.transaction] : [],
        };
      }
      return {
        ok: true,
        summary: `Cancelled task ${taskId}`,
        payload: {
          task_id: taskId,
          method: result.aborted ? "abortTask" : "cancelTask",
          status: "submitted, not yet confirmed on-chain",
        },
        transactions: [result.transaction],
      };
    }

    case "get_transaction": {
      const tx = await getRelayedTransaction(String(args.transaction_id));
      if (!tx) {
        return { ok: false, summary: "Transaction not found", payload: { error: "Transaction not found" }, transactions: [] };
      }
      return {
        ok: true,
        summary: `Transaction ${tx.kind} is ${tx.status}`,
        payload: transactionResponse(tx),
        transactions: [tx],
      };
    }

    default:
      return { ok: false, summary: `Unknown tool ${name}`, payload: { error: "Unknown tool" }, transactions: [] };
  }
}

export async function runChatTurn(history: ChatMessage[]): Promise<ChatTurn> {
  if (!isChatAvailable()) {
    throw new Error("Agent chat requires OPENAI_API_KEY in .env.local");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const steps: AgentStep[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
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
      let outcome: ToolOutcome;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        outcome = await runTool(call.function.name, args);
      } catch (err) {
        const error = err instanceof Error ? err.message : "Tool execution failed";
        outcome = { ok: false, summary: `${call.function.name} errored: ${error}`, payload: { error }, transactions: [] };
      }

      steps.push({
        tool: call.function.name,
        args,
        ok: outcome.ok,
        summary: outcome.summary,
        transactions: outcome.transactions.map(transactionResponse),
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.payload),
      });
    }
  }

  return {
    reply:
      "I stopped after too many tool steps without reaching an answer. Tell me the single action you want and I'll do just that.",
    steps,
  };
}
