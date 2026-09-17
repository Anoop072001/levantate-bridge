import {
  ARC_USDC_FAUCET_URL,
  checkAgentFunding,
  fundingHintPayload,
  readAgentUsdcBalance,
  usdcMicroToNumber,
} from "../chain/agent-wallet.js";
import { createArcPublicClient } from "../chain/escrow.js";
import { enrichAllTasks, enrichTask, getLiveTaskRecord, listLiveTaskRecords } from "../chain/task-view.js";
import { relayChainStatus, transactionResponse } from "../relayer/submit.js";
import {
  getProof,
  getRelayedTransaction,
  listBidsForTask,
} from "../store.js";
import {
  approveWork,
  cancelTask,
  postTask,
  reclaimTask,
  rejectWork,
  selectWinner,
  transferAgentUsdc,
  AGENT_TRANSFER_GAS_RESERVE_MICRO,
  type AgentActor,
} from "./operations.js";
import { describeProofForAgent, evaluateProofRecord } from "../proof/evaluate-record.js";
import { isProofEvaluationAvailable } from "./proof-evaluator.js";
import { proofDownloadUrl } from "../proof/download-url.js";
import { parseProofContent } from "../proof/payload.js";
import { scoreBids } from "./score-bids.js";

export interface AgentToolOutcome {
  ok: boolean;
  summary: string;
  payload: unknown;
  transactions: ReturnType<typeof transactionResponse>[];
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

/** Wall-clock deadline context so MCP tools do not treat stale on-chain Assigned as in-window. */
function agentDeadlineContext(
  state: number,
  bidDeadline: string,
  submissionDeadline: string,
  bidCountThisRound: number,
  round: number,
) {
  const now = Math.floor(Date.now() / 1000);
  const bidUnix = Number(bidDeadline);
  const subUnix = Number(submissionDeadline);
  const bidDeadlinePassed = bidUnix > 0 && now > bidUnix;
  const submissionDeadlinePassed = subUnix > 0 && now > subUnix;
  const inBidPhase = state === 0 || state === 1;

  let submissionWindowStatus: string;
  if (state === 2 && subUnix > 0) {
    submissionWindowStatus = submissionDeadlinePassed ? "missed_deadline" : "in_window";
  } else if (state >= 3) {
    submissionWindowStatus = "submitted_or_later";
  } else {
    submissionWindowStatus = "not_assigned_yet";
  }

  let biddingStatus: string;
  if (!inBidPhase) {
    biddingStatus = "not_in_bid_phase";
  } else if (!bidDeadlinePassed) {
    biddingStatus = "accepting_bids";
  } else if (bidCountThisRound > 0) {
    biddingStatus = "bid_deadline_passed_select_winner";
  } else {
    biddingStatus = "bid_deadline_passed_no_bids";
  }

  return {
    bid_deadline_passed: bidDeadlinePassed,
    submission_deadline_passed: submissionDeadlinePassed,
    seconds_until_bid_deadline: bidUnix > 0 ? bidUnix - now : null,
    seconds_until_submission_deadline: subUnix > 0 ? subUnix - now : null,
    submission_window_status: submissionWindowStatus,
    bidding_status: biddingStatus,
    was_reclaimed: round > 0,
    now_utc: new Date().toISOString(),
  };
}

async function taskSummaries() {
  const client = createArcPublicClient();
  const stored = await listLiveTaskRecords(client);
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
    ...agentDeadlineContext(
      t.state,
      t.bidDeadline,
      t.submissionDeadline,
      Number(t.currentRoundBidCount),
      t.round,
    ),
    assigned_worker: t.assignedWorker,
  }));
}

export async function runAgentTool(
  name: string,
  args: Record<string, unknown>,
  actor: AgentActor,
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
      const stored = await getLiveTaskRecord(taskId);
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
          bid_count_this_round: bids.length,
          ...agentDeadlineContext(
            task.state,
            task.bidDeadline,
            task.submissionDeadline,
            bids.length,
            task.round,
          ),
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
      const stored = await getLiveTaskRecord(taskId);
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

    case "get_agent_wallet": {
      const requiredMicro =
        args.required_usdc === undefined
          ? 0n
          : BigInt(Math.round(Number(args.required_usdc) * 1_000_000));
      const { address, balanceMicro } = await readAgentUsdcBalance(actor.address);
      const check =
        requiredMicro > 0n
          ? await checkAgentFunding(requiredMicro, address)
          : {
              agentAddress: address,
              balanceMicro,
              requiredMicro: 0n,
              sufficient: balanceMicro > 0n,
              faucetUrl: ARC_USDC_FAUCET_URL,
            };
      const hint = fundingHintPayload({
        ...check,
        requiredMicro: requiredMicro > 0n ? requiredMicro : 0n,
      });
      const summary =
        requiredMicro > 0n && !check.sufficient
          ? `Agent wallet underfunded — ${hint.balance_usdc.toFixed(2)} USDC available, ${hint.required_usdc.toFixed(2)} required`
          : `Agent wallet ${address} holds ${usdcMicroToNumber(balanceMicro).toFixed(2)} USDC`;
      return {
        ok: check.sufficient,
        summary,
        payload: { funding: hint, sufficient: check.sufficient },
        transactions: [],
      };
    }

    case "transfer_usdc": {
      const to = String(args.to ?? "");
      const sendAll = args.send_all === true;
      let amountMicro: bigint;
      if (sendAll) {
        const { balanceMicro } = await readAgentUsdcBalance(actor.address);
        amountMicro = balanceMicro - AGENT_TRANSFER_GAS_RESERVE_MICRO;
        if (amountMicro <= 0n) {
          return {
            ok: false,
            summary: "Agent wallet has no transferable USDC after the 0.02 gas reserve",
            payload: { error: "Insufficient USDC to transfer" },
            transactions: [],
          };
        }
      } else if (args.amount_usdc === undefined) {
        return {
          ok: false,
          summary: "amount_usdc required unless send_all is true",
          payload: { error: "amount_usdc required" },
          transactions: [],
        };
      } else {
        const n = Number(args.amount_usdc);
        if (!Number.isFinite(n) || n <= 0) {
          return {
            ok: false,
            summary: "amount_usdc must be a positive number",
            payload: { error: "amount_usdc must be a positive number" },
            transactions: [],
          };
        }
        amountMicro = BigInt(toMicro(n));
      }
      const result = await transferAgentUsdc(to, amountMicro, actor);
      if (!result.ok) {
        return {
          ok: false,
          summary: result.error,
          payload: {
            error: result.error,
            ...(result.funding ? { funding: result.funding } : {}),
          },
          transactions: result.transaction ? [transactionResponse(result.transaction)] : [],
        };
      }
      return {
        ok: true,
        summary: `Sent ${usdc(result.amountMicro)} USDC to ${result.to} — ${relayChainStatus(result.transaction)}`,
        payload: {
          to: result.to,
          amount_usdc: usdc(result.amountMicro),
          status: relayChainStatus(result.transaction),
        },
        transactions: [transactionResponse(result.transaction)],
      };
    }

    case "post_task": {
      const result = await postTask(
        {
          description: String(args.description ?? ""),
          bidDeadlineSeconds: Math.round(Number(args.bid_deadline_minutes) * 60),
          submissionWindowSeconds:
            args.submission_window_minutes === undefined
              ? undefined
              : Math.round(Number(args.submission_window_minutes) * 60),
          maxBudgetMicro:
            args.max_budget_usdc === undefined ? undefined : toMicro(Number(args.max_budget_usdc)),
        },
        actor,
      );
      if (!result.ok) {
        return {
          ok: false,
          summary: result.funding
            ? `post_task blocked — fund agent wallet (${result.funding.agent_address})`
            : `post_task failed: ${result.error}`,
          payload: {
            error: result.error,
            ...(result.funding ? { funding: result.funding } : {}),
          },
          transactions: result.transaction ? [transactionResponse(result.transaction)] : [],
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
          status: relayChainStatus(result.task.transactions[result.task.transactions.length - 1]!),
        },
        transactions: result.task.transactions.map(transactionResponse),
      };
    }

    case "select_winner": {
      const taskId = Number(args.task_id);
      const result = await selectWinner(
        taskId,
        args.bid_id === undefined ? undefined : Number(args.bid_id),
        actor,
      );
      if (!result.ok) {
        return {
          ok: false,
          summary: `select_winner failed: ${result.error}`,
          payload: { error: result.error, scoring: result.selection?.reasoning.message ?? null },
          transactions: result.transaction ? [transactionResponse(result.transaction)] : [],
        };
      }
      return {
        ok: true,
        summary: result.alreadyAssigned
          ? `Task ${taskId} already assigned to ${result.workerAddress}`
          : `Assigned task ${taskId} to bid ${result.bidId}`,
        payload: {
          task_id: taskId,
          bid_id: result.bidId,
          worker: result.workerAddress,
          already_assigned: result.alreadyAssigned ?? false,
          scoring: result.selection?.reasoning.message ?? "explicit bid id",
          status: result.transaction ? relayChainStatus(result.transaction) : "confirmed on-chain (already assigned)",
        },
        transactions: result.transaction ? [transactionResponse(result.transaction)] : [],
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
      const stored = await getLiveTaskRecord(taskId);
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
      const verdict = await evaluateProofRecord(task.description, proof);
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
      const result = approve ? await approveWork(taskId, actor) : await rejectWork(taskId, actor);
      if (!result.ok) {
        return {
          ok: false,
          summary: `${name} failed: ${result.error}`,
          payload: { error: result.error },
          transactions: result.transaction ? [transactionResponse(result.transaction)] : [],
        };
      }
      return {
        ok: true,
        summary: approve ? `Approved task ${taskId}` : `Rejected work on task ${taskId}`,
        payload: {
          task_id: taskId,
          status: relayChainStatus(result.transaction),
          note: approve
            ? "Payout lands in the worker's self-custodied wallet once the receipt succeeds."
            : "Task returns to Assigned with a refreshed submission deadline once confirmed.",
        },
        transactions: [transactionResponse(result.transaction)],
      };
    }

    case "reclaim_task": {
      const taskId = Number(args.task_id);
      const result = await reclaimTask(
        taskId,
        Math.round(Number(args.new_bid_deadline_minutes) * 60),
        actor,
      );
      if (!result.ok) {
        return {
          ok: false,
          summary: `reclaim_task failed: ${result.error}`,
          payload: { error: result.error },
          transactions: result.transaction ? [transactionResponse(result.transaction)] : [],
        };
      }
      return {
        ok: true,
        summary: `Reclaimed task ${taskId} into round ${result.round}`,
        payload: {
          task_id: taskId,
          round: result.round,
          status: relayChainStatus(result.transaction),
        },
        transactions: [transactionResponse(result.transaction)],
      };
    }

    case "cancel_task": {
      const taskId = Number(args.task_id);
      const result = await cancelTask(taskId, actor);
      if (!result.ok) {
        return {
          ok: false,
          summary: `cancel_task failed: ${result.error}`,
          payload: { error: result.error },
          transactions: result.transaction ? [transactionResponse(result.transaction)] : [],
        };
      }
      return {
        ok: true,
        summary: `Cancelled task ${taskId}`,
        payload: {
          task_id: taskId,
          method: result.aborted ? "abortTask" : "cancelTask",
          status: relayChainStatus(result.transaction),
        },
        transactions: [transactionResponse(result.transaction)],
      };
    }

    case "get_proof_download": {
      const taskId = Number(args.task_id);
      const stored = await getLiveTaskRecord(taskId);
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
        transactions: [transactionResponse(tx)],
      };
    }

    default:
      return { ok: false, summary: `Unknown tool ${name}`, payload: { error: "Unknown tool" }, transactions: [] };
  }
}
