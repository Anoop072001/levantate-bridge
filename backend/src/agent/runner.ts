import { createArcPublicClient } from "../chain/escrow.js";
import { nowSeconds, readOnChainTask } from "../chain/task-state.js";
import {
  getProof,
  getTask,
  listBidsForTask,
  listTasks,
  type BidRecord,
  type RelayedTransaction,
} from "../store.js";
import { deriveTaskParams } from "./budget.js";
import { approveWork, rejectWork, selectWinner } from "./operations.js";
import { evaluateProof, isProofEvaluationAvailable } from "./proof-evaluator.js";
import { scoreBids } from "./score-bids.js";

export interface AgentAction {
  kind: "select_winner" | "approve_work" | "reject_work";
  taskId: number;
  reasoning: unknown;
  transaction?: RelayedTransaction;
  error?: string;
}

export interface AgentRunResult {
  actions: AgentAction[];
  timestamp: string;
}

async function assignWinner(taskId: number): Promise<AgentAction> {
  const result = await selectWinner(taskId);
  if (!result.ok) {
    return {
      kind: "select_winner",
      taskId,
      reasoning: { selection: result.selection ?? null },
      transaction: result.transaction,
      error: result.error,
    };
  }
  return {
    kind: "select_winner",
    taskId,
    reasoning: { selection: result.selection },
    transaction: result.transaction,
  };
}

async function evaluateSubmittedTask(taskId: number): Promise<AgentAction> {
  const stored = await getTask(taskId);
  if (!stored) {
    return { kind: "approve_work", taskId, reasoning: {}, error: "Task not in store" };
  }

  const onChain = await readOnChainTask(taskId);
  const proof = await getProof(taskId, onChain.round);
  if (!proof) {
    return { kind: "approve_work", taskId, reasoning: {}, error: "No proof stored" };
  }

  let verdict;
  try {
    verdict = await evaluateProof(stored.description, proof.content);
  } catch (err) {
    return {
      kind: "approve_work",
      taskId,
      reasoning: {},
      error: err instanceof Error ? err.message : "Proof evaluation failed",
    };
  }

  console.log(
    `[agent] task ${taskId} proof verdict: ${verdict.approved ? "APPROVE" : "REJECT"} — ${verdict.reason}`,
  );

  const kind = verdict.approved ? "approve_work" : "reject_work";
  const result = verdict.approved ? await approveWork(taskId) : await rejectWork(taskId);

  return {
    kind,
    taskId,
    reasoning: { verdict },
    transaction: result.transaction,
    error: result.ok ? undefined : result.error,
  };
}

export async function runAgentCycle(): Promise<AgentRunResult> {
  const client = createArcPublicClient();
  const actions: AgentAction[] = [];
  const stored = await listTasks();

  for (const task of stored) {
    const onChain = await readOnChainTask(task.id, client);

    if (onChain.state === 1 && nowSeconds() > onChain.bidDeadline) {
      const bids = await listBidsForTask(task.id, onChain.round);
      if (bids.length > 0) {
        actions.push(await assignWinner(task.id));
      }
    }

    if (onChain.state === 3) {
      if (!isProofEvaluationAvailable()) {
        console.log(`[agent] task ${task.id} submitted — skipping proof evaluation (no LLM API key)`);
      } else {
        actions.push(await evaluateSubmittedTask(task.id));
      }
    }

    // Missed submission deadlines are not auto-reclaimed — reclaim is an explicit call so the
    // agent operator decides whether the task is still worth reopening.
  }

  return { actions, timestamp: new Date().toISOString() };
}

export { deriveTaskParams, scoreBids };
export type { BidRecord };
