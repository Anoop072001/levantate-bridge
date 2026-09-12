import { TASK_STATE, type TaskStateName } from "../chain/task-state.js";
import { isSubgraphAvailable, querySubgraph } from "./client.js";

const ZERO = "0x0000000000000000000000000000000000000000";

const STATE_TO_NUM: Record<string, number> = {
  Open: 0,
  Bidding: 1,
  Assigned: 2,
  Submitted: 3,
  Paid: 4,
  Cancelled: 5,
};

export interface SubgraphTaskRow {
  id: string;
  state: string;
  round: number;
  maxBudget: string;
  bidDeadline: string;
  submissionWindow: string;
  submissionDeadline: string;
  assignedWorker: { id: string; address: string } | null;
  bids: { id: string; round: number }[];
}

export interface SubgraphEnrichedTaskFields {
  bidDeadline: string;
  submissionWindow: string;
  submissionDeadline: string;
  round: number;
  state: number;
  stateLabel: TaskStateName;
  assignedWorker: `0x${string}`;
  currentRoundBidCount: string;
  maxBudget: string;
  stale: false;
}

const TASKS_BATCH_QUERY = `
  query ($ids: [ID!]!) {
    tasks(where: { id_in: $ids }) {
      id
      state
      round
      maxBudget
      bidDeadline
      submissionWindow
      submissionDeadline
      assignedWorker { id address }
      bids { id round }
    }
  }`;

const TASK_CACHE_MS = 15_000;
let taskBatchCache: { at: number; key: string; data: Map<string, SubgraphTaskRow> } | null = null;
let taskBatchInflight: Promise<Map<string, SubgraphTaskRow>> | null = null;

function cacheKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

export function mapSubgraphTaskRow(row: SubgraphTaskRow): SubgraphEnrichedTaskFields {
  const stateLabel = (TASK_STATE.includes(row.state as TaskStateName)
    ? row.state
    : "Open") as TaskStateName;
  const state = STATE_TO_NUM[row.state] ?? 0;
  const bidCount = row.bids.filter((b) => b.round === row.round).length;
  const worker = row.assignedWorker?.address?.toLowerCase();

  return {
    bidDeadline: row.bidDeadline,
    submissionWindow: row.submissionWindow,
    submissionDeadline: row.submissionDeadline,
    round: row.round,
    state,
    stateLabel,
    assignedWorker: (worker && worker !== ZERO ? worker : ZERO) as `0x${string}`,
    currentRoundBidCount: String(bidCount),
    maxBudget: row.maxBudget,
    stale: false,
  };
}

export async function fetchSubgraphTasksBatch(ids: string[]): Promise<Map<string, SubgraphTaskRow>> {
  const unique = [...new Set(ids.map(String))].filter(Boolean);
  const result = new Map<string, SubgraphTaskRow>();
  if (unique.length === 0) return result;

  const now = Date.now();
  const key = cacheKey(unique);
  if (taskBatchCache && taskBatchCache.key === key && now - taskBatchCache.at < TASK_CACHE_MS) {
    return taskBatchCache.data;
  }
  if (taskBatchInflight) return taskBatchInflight;

  if (!isSubgraphAvailable()) {
    return taskBatchCache?.data ?? result;
  }

  taskBatchInflight = (async () => {
    try {
      const data = await querySubgraph<{ tasks: SubgraphTaskRow[] }>(TASKS_BATCH_QUERY, {
        ids: unique,
      });
      const map = new Map<string, SubgraphTaskRow>();
      for (const task of data.tasks) {
        map.set(task.id, task);
      }
      taskBatchCache = { at: Date.now(), key, data: map };
      return map;
    } catch {
      return taskBatchCache?.data ?? result;
    } finally {
      taskBatchInflight = null;
    }
  })();

  return taskBatchInflight;
}

export async function fetchSubgraphTask(taskId: string): Promise<SubgraphTaskRow | null> {
  const map = await fetchSubgraphTasksBatch([taskId]);
  return map.get(taskId) ?? null;
}

/** Drop cached reads after a relayed write lands so the next poll picks up indexer lag honestly. */
export function invalidateSubgraphTaskCache(): void {
  taskBatchCache = null;
}
