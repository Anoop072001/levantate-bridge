import { actorFromAgent } from "../auth/agent.js";
import { invalidateOnChainTaskCache, nowSeconds, readOnChainTask } from "../chain/task-state.js";
import { listLiveTaskRecords } from "../chain/task-view.js";
import {
  findAgentByAddress,
  listBidsForTask,
  listInFlightRelaysForTask,
  type BidRecord,
  type RelayedTransaction,
} from "../store.js";
import type { AgentActor } from "./operations.js";

export interface AgentAction {
  kind: "select_winner";
  taskId: number;
  reasoning: unknown;
  transaction?: RelayedTransaction;
  error?: string;
}

export interface AgentRunResult {
  actions: AgentAction[];
  timestamp: string;
}

async function actorForTask(taskId: number): Promise<AgentActor | undefined> {
  const onChain = await readOnChainTask(taskId);
  const poster = onChain.poster;
  if (!poster) return undefined;
  const agent = await findAgentByAddress(poster);
  if (!agent) {
    console.warn(`[agent] task ${taskId} has poster ${poster} with no registered Circle wallet`);
    return undefined;
  }
  return actorFromAgent(agent);
}

async function assignWinner(taskId: number): Promise<AgentAction> {
  const actor = await actorForTask(taskId);
  if (!actor) {
    return { kind: "select_winner", taskId, reasoning: {}, error: "No registered agent wallet for this task poster" };
  }
  const { selectWinner } = await import("./operations.js");
  const result = await selectWinner(taskId, undefined, actor);
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

async function maybeAssignWinner(taskId: number): Promise<AgentAction | undefined> {
  const inFlight = await listInFlightRelaysForTask(taskId);
  if (inFlight.some((tx) => tx.kind === "select_winner")) {
    return undefined;
  }

  invalidateOnChainTaskCache(taskId);
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

/** Select winners for tasks whose bid deadline passed. Proof review is the operator's MCP model. */
export async function runWinnerSelectionCycle(): Promise<AgentRunResult> {
  const actions: AgentAction[] = [];
  const stored = await listLiveTaskRecords();

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

/** Same as winner selection — kept as `runAgentCycle` for `POST /api/agent/run-once`. */
export async function runAgentCycle(): Promise<AgentRunResult> {
  return runWinnerSelectionCycle();
}

export type { BidRecord };
