import type OpenAI from "openai";
import { createArcPublicClient } from "../chain/escrow.js";
import { enrichAllTasks, enrichTask } from "../chain/task-view.js";
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
import { describeProofForAgent, evaluateProofRecord } from "../proof/evaluate-record.js";
import { isProofEvaluationAvailable } from "./proof-evaluator.js";
import { proofDownloadUrl } from "../proof/download-url.js";
import { parseProofContent } from "../proof/payload.js";
import { scoreBids } from "./score-bids.js";

export interface AgentStepDownload {
  label: string;
  url: string;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  /** Relayed transactions this step produced, so the UI can track them to confirmation (D6). */
  transactions: ReturnType<typeof transactionResponse>[];
  /** Clickable file downloads surfaced after get_task or get_proof_download. */
  downloads?: AgentStepDownload[];
}

export interface AgentToolOutcome {
  ok: boolean;
  summary: string;
  payload: unknown;
  transactions: RelayedTransaction[];
}

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

export function downloadsFromToolPayload(
  tool: string,
  payload: unknown,
): AgentStepDownload[] {
  if (!payload || typeof payload !== "object") return [];

  if (tool === "get_task") {
    const proof = (payload as { submitted_proof?: { kind?: string; fileName?: string; downloadUrl?: string } })
      .submitted_proof;
    if (proof?.kind === "file" && proof.downloadUrl) {
      return [{ label: proof.fileName ?? "Submitted file", url: proof.downloadUrl }];
    }
    return [];
  }

  if (tool === "get_proof_download") {
    const p = payload as { download_url?: string; file_name?: string };
    if (p.download_url) {
      return [{ label: p.file_name ?? "Submitted file", url: p.download_url }];
    }
  }

  return [];
}

export const AGENT_OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
        "Full detail for one task: on-chain state, bids, and submitted proof content (including text extracted from uploaded Excel/PDF/Word files) when work was submitted or paid. File proofs include download_url for the original upload.",
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
      name: "evaluate_proof",
      description:
        "Run the LLM proof evaluator on submitted work for a task in Submitted or Paid state. Returns APPROVE/REJECT with a reason. Does not release payment — call approve_work or reject_work after the operator confirms.",
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
      name: "get_proof_download",
      description:
        "Return a download link for the worker's uploaded proof file on a Submitted or Paid task. Use when the operator asks to download the submission.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "integer" },
          round: { type: "integer", description: "Task round. Omit for the current round." },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transaction",
      description:
        "Stored relayed transaction record (hash and submission status). Task state updates when the operator refreshes the page.",
      parameters: {
        type: "object",
        properties: { transaction_id: { type: "string" } },
        required: ["transaction_id"],
      },
    },
  },
];

async function taskSummaries() {
  const client = createArcPublicClient();
  const stored = await listTasks();
  const enriched = await enrichAllTasks(stored, client);
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

export async function runAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<AgentToolOutcome> {
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
      const proof =
        task.state === 3 || task.state === 4 ? await getProof(taskId, task.round) : undefined;
      const submittedProof = proof ? await describeProofForAgent(proof) : null;
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
          submitted_proof: submittedProof,
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

    case "evaluate_proof": {
      const taskId = Number(args.task_id);
      if (!isProofEvaluationAvailable()) {
        return {
          ok: false,
          summary: "Proof evaluation unavailable (no LLM API key)",
          payload: {
            error: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local",
          },
          transactions: [],
        };
      }
      const stored = await getTask(taskId);
      if (!stored) {
        return { ok: false, summary: `Task ${taskId} not found`, payload: { error: "Task not found" }, transactions: [] };
      }
      const task = await enrichTask(stored);
      if (task.state !== 3 && task.state !== 4) {
        return {
          ok: false,
          summary: `Task ${taskId} is ${task.stateLabel} — nothing to evaluate yet`,
          payload: { error: "Proof evaluation requires Submitted or Paid state" },
          transactions: [],
        };
      }
      const proof = await getProof(taskId, task.round);
      if (!proof) {
        return {
          ok: false,
          summary: `No proof stored for task ${taskId}`,
          payload: { error: "Proof not found" },
          transactions: [],
        };
      }
      const verdict = await evaluateProofRecord(stored.description, proof);
      return {
        ok: true,
        summary: `Task ${taskId}: ${verdict.approved ? "APPROVE" : "REJECT"} — ${verdict.reason}`,
        payload: {
          task_id: taskId,
          state: task.stateLabel,
          approved: verdict.approved,
          reason: verdict.reason,
        },
        transactions: [],
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

    case "get_proof_download": {
      const taskId = Number(args.task_id);
      const stored = await getTask(taskId);
      if (!stored) {
        return { ok: false, summary: `Task ${taskId} not found`, payload: { error: "Task not found" }, transactions: [] };
      }
      const task = await enrichTask(stored);
      if (task.state !== 3 && task.state !== 4) {
        return {
          ok: false,
          summary: `Task ${taskId} has no submitted proof yet (${task.stateLabel})`,
          payload: { error: "Proof not available until work is submitted" },
          transactions: [],
        };
      }
      const round = args.round !== undefined ? Number(args.round) : task.round;
      const proof = await getProof(taskId, round);
      if (!proof) {
        return { ok: false, summary: `No proof stored for task ${taskId}`, payload: { error: "Proof not found" }, transactions: [] };
      }
      const payload = parseProofContent(proof.content);
      if (payload.kind !== "file") {
        return {
          ok: false,
          summary: `Task ${taskId} proof is written text, not a file`,
          payload: { error: "No file upload for this task" },
          transactions: [],
        };
      }
      const downloadUrl = proofDownloadUrl(taskId, round);
      return {
        ok: true,
        summary: `Download link ready for ${payload.fileName}`,
        payload: {
          task_id: taskId,
          round,
          file_name: payload.fileName,
          mime_type: payload.mimeType,
          size_bytes: payload.sizeBytes,
          download_url: downloadUrl,
        },
        transactions: [],
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
