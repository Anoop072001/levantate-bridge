import { TASK_STATE, type OnChainTask, type TaskStateName } from "../chain/task-state.js";
import { querySubgraph } from "./client.js";

interface SubgraphTaskRow {
  task: {
    description: string;
    maxBudget: string;
    bidDeadline: string;
    submissionWindow: string;
    submissionDeadline: string;
    round: number;
    state: string;
    winningBidAmount: string;
    assignedWorker: { address: string } | null;
    bids: Array<{ id: string; round: number }>;
  } | null;
}

const TASK_QUERY = `
  query TaskState($id: ID!) {
    task(id: $id) {
      description
      maxBudget
      bidDeadline
      submissionWindow
      submissionDeadline
      round
      state
      winningBidAmount
      assignedWorker { address }
      bids { id round }
    }
  }
`;

function stateToNumber(label: string): number {
  const idx = TASK_STATE.indexOf(label as TaskStateName);
  return idx >= 0 ? idx : 0;
}

export async function readTaskFromSubgraph(taskId: number): Promise<OnChainTask | null> {
  const data = await querySubgraph<SubgraphTaskRow>(TASK_QUERY, { id: taskId.toString() });
  const task = data.task;
  if (!task) return null;

  const state = stateToNumber(task.state);
  const worker = task.assignedWorker?.address ?? "0x0000000000000000000000000000000000000000";
  const bidCount = task.bids.filter((b) => b.round === task.round).length;

  return {
    description: task.description,
    maxBudget: BigInt(task.maxBudget),
    bidDeadline: BigInt(task.bidDeadline),
    submissionWindow: BigInt(task.submissionWindow),
    submissionDeadline: BigInt(task.submissionDeadline),
    round: task.round,
    state,
    stateLabel: TASK_STATE[state] ?? "Open",
    assignedWorker: worker as `0x${string}`,
    winningBidId: 0n,
    winningBidAmount: BigInt(task.winningBidAmount),
    proofHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    currentRoundBidCount: BigInt(bidCount),
  };
}
