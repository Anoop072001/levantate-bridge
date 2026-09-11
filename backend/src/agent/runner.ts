import { createArcPublicClient } from "../chain/escrow.js";
import { nowSeconds, readOnChainTask } from "../chain/task-state.js";
import {
  getProof,
  getTask,
  listBidsForTask,
  listInFlightRelaysForTask,
  listTasks,
  type BidRecord,
  type RelayedTransaction,
} from "../store.js";
import { isProofEvaluationAvailable } from "./proof-evaluator.js";

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
  const { selectWinner } = await import("./operations.js");
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const { evaluateProofRecord } = await import("../proof/evaluate-record.js");
    verdict = await evaluateProofRecord(stored.description, proof);
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
  const { approveWork, rejectWork } = await import("./operations.js");
  const result = verdict.approved ? await approveWork(taskId) : await rejectWork(taskId);

  return {
    kind,
    taskId,
    reasoning: { verdict },
    transaction: result.transaction,
    error: result.ok ? undefined : result.error,
  };
}

async function maybeAssignWinner(taskId: number): Promise<AgentAction | undefined> {
  const inFlight = await listInFlightRelaysForTask(taskId);
  if (inFlight.some((tx) => tx.kind === "select_winner")) {
    return undefined;
  }

  const onChain = await readOnChainTask(taskId);
  if (onChain.state !== 1 || nowSeconds() <= onChain.bidDeadline) {
    return undefined;
  }

  const bids = await listBidsForTask(taskId, onChain.round);
  if (bids.length === 0) {
    return undefined;
  }

  return assignWinner(taskId);
}

/**
 * Evaluates and approves/rejects proof for one task. Called when a worker submits work —
 * waits for on-chain Submitted state after the relay lands.
 */
export async function reviewSubmittedTask(taskId: number): Promise<AgentAction | undefined> {
  if (!isProofEvaluationAvailable()) {
    console.log(`[agent] task ${taskId} proof review skipped (no LLM API key)`);
    return undefined;
  }

  const inFlight = await listInFlightRelaysForTask(taskId);
  if (inFlight.some((tx) => tx.kind === "approve_work" || tx.kind === "reject_work")) {
    return undefined;
  }

  for (let i = 0; i < 30; i++) {
    const onChain = await readOnChainTask(taskId);
    if (onChain.state === 3) {
      return evaluateSubmittedTask(taskId);
    }
    if (onChain.state !== 2) {
      console.warn(
        `[agent] task ${taskId} proof review skipped — state is ${onChain.stateLabel}, expected Assigned or Submitted`,
      );
      return undefined;
    }
    await sleep(2000);
  }

  console.warn(`[agent] task ${taskId} proof review timed out waiting for Submitted state`);
  return undefined;
}

/** Select winners for tasks whose bid deadline passed. Runs by default; proof review stays manual. */
export async function runWinnerSelectionCycle(): Promise<AgentRunResult> {
  const actions: AgentAction[] = [];
  const stored = await listTasks();

  for (const task of stored) {
    try {
      const action = await maybeAssignWinner(task.id);
      if (action) actions.push(action);
    } catch (err) {
      console.warn(
        `[agent] task ${task.id} winner selection skipped: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  return { actions, timestamp: new Date().toISOString() };
}

/** Manual recovery: re-review any task already in Submitted state (POST /api/agent/run-once). */
async function runProofReviewCycle(): Promise<AgentAction[]> {
  const actions: AgentAction[] = [];
  const client = createArcPublicClient();
  const stored = await listTasks();

  for (const task of stored) {
    const onChain = await readOnChainTask(task.id, client);
    if (onChain.state !== 3) continue;
    const action = await reviewSubmittedTask(task.id);
    if (action) actions.push(action);
  }

  return actions;
}

export async function runAgentCycle(): Promise<AgentRunResult> {
  const winnerResult = await runWinnerSelectionCycle();
  const proofActions = await runProofReviewCycle();
  const actions: AgentAction[] = [...winnerResult.actions, ...proofActions];

  // Missed submission deadlines are not auto-reclaimed — reclaim is an explicit call so the
  // agent operator decides whether the task is still worth reopening.

  return { actions, timestamp: new Date().toISOString() };
}

export type { BidRecord };
