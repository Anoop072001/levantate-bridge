import {
  checkAgentFunding,
  fundingHintPayload,
  insufficientFundingMessage,
  type AgentFundingHint,
} from "../chain/agent-wallet.js";
import { createArcPublicClient, getEscrowAddress, getUsdcAddress } from "../chain/escrow.js";
import { nowSeconds, readOnChainTask } from "../chain/task-state.js";
import { requireEnv } from "../env.js";
import { enqueueContractCall } from "../relayer/submit.js";
import {
  getBid,
  getTask,
  listBidsForTask,
  upsertTask,
  type RelayedTransaction,
} from "../store.js";
import { deriveTaskParams, type AgentTaskParams } from "./budget.js";
import { scoreBids, type BidSelectionResult } from "./score-bids.js";

/**
 * The escrow write path, guarded once. Every caller — HTTP routes, the autonomous loop, and the
 * chat agent — goes through here so task-state rules cannot drift between entry points.
 */

export interface OpFailure {
  ok: false;
  status: number;
  error: string;
  /** Present when the call reached Circle and came back failed rather than being rejected upfront. */
  transaction?: RelayedTransaction;
  selection?: BidSelectionResult;
  /** Present when the agent wallet lacks USDC to fund escrow. */
  funding?: AgentFundingHint;
}

export type OpResult<T> = ({ ok: true } & T) | OpFailure;

const NEXT_ID_ABI = [
  { name: "nextTaskId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

function failed(tx: RelayedTransaction, label: string): OpFailure {
  return { ok: false, status: 502, error: tx.error ?? `${label} failed`, transaction: tx };
}

export interface PostTaskInput {
  description: string;
  bidDeadlineSeconds: number;
  /** Omit to use the subgraph-derived median submission window. */
  submissionWindowSeconds?: number;
  /** Omit to use the subgraph-derived median paid amount. 6-decimal USDC. */
  maxBudgetMicro?: string;
}

export interface PostedTask {
  taskId: number;
  maxBudget: bigint;
  bidDeadline: bigint;
  submissionWindow: bigint;
  /** Null when both budget and window were supplied explicitly, so no subgraph query ran. */
  budgetReasoning: AgentTaskParams["reasoning"] | null;
  transactions: RelayedTransaction[];
}

export async function postTask(input: PostTaskInput): Promise<OpResult<{ task: PostedTask }>> {
  const description = input.description.trim();
  if (!description) {
    return { ok: false, status: 400, error: "description required" };
  }
  if (!Number.isFinite(input.bidDeadlineSeconds) || input.bidDeadlineSeconds <= 0) {
    return { ok: false, status: 400, error: "bidDeadlineSeconds must be a positive number" };
  }

  const client = createArcPublicClient();
  const escrowAddress = getEscrowAddress();
  const agentWalletId = requireEnv("CIRCLE_AGENT_WALLET_ID");

  // The Graph sets the numbers the agent cannot know on its own (D1).
  const needsDerived =
    input.maxBudgetMicro === undefined || input.submissionWindowSeconds === undefined;
  const derived = needsDerived ? await deriveTaskParams() : null;

  const maxBudget =
    input.maxBudgetMicro !== undefined ? BigInt(input.maxBudgetMicro) : derived!.maxBudget;
  const submissionWindow =
    input.submissionWindowSeconds !== undefined
      ? BigInt(input.submissionWindowSeconds)
      : derived!.submissionWindow;

  if (maxBudget <= 0n) {
    return { ok: false, status: 400, error: "maxBudget must be greater than zero" };
  }

  const bidDeadline = nowSeconds() + BigInt(Math.floor(input.bidDeadlineSeconds));

  const nextId = (await client.readContract({
    address: escrowAddress,
    abi: NEXT_ID_ABI,
    functionName: "nextTaskId",
  })) as bigint;
  const taskId = Number(nextId);

  console.log(
    `[agent] posting task ${taskId} — budget=${maxBudget}, submissionWindow=${submissionWindow}, ` +
      `medianPaid=${derived?.reasoning.medianPaidAmount ?? "explicit"}`,
  );

  const funding = await checkAgentFunding(maxBudget);
  if (!funding.sufficient) {
    return {
      ok: false,
      status: 402,
      error: insufficientFundingMessage(funding),
      funding: fundingHintPayload(funding),
    };
  }

  const approveTx = await enqueueContractCall({
    walletId: agentWalletId,
    kind: "usdc_approve",
    expectedEvent: "Approval",
    contractAddress: getUsdcAddress(),
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [escrowAddress, maxBudget.toString()],
  });
  if (approveTx.status === "failed") return failed(approveTx, "USDC approve");

  const postTx = await enqueueContractCall({
    walletId: agentWalletId,
    kind: "post_task",
    expectedEvent: "TaskPosted",
    contractAddress: escrowAddress,
    abiFunctionSignature: "postTask(string,uint256,uint256,uint256)",
    abiParameters: [
      description,
      maxBudget.toString(),
      bidDeadline.toString(),
      submissionWindow.toString(),
    ],
    taskId,
    round: 0,
  });
  if (postTx.status === "failed") return failed(postTx, "postTask");

  await upsertTask({
    id: taskId,
    description,
    maxBudget: maxBudget.toString(),
    bidDeadline: bidDeadline.toString(),
    submissionWindow: submissionWindow.toString(),
    round: 0,
    state: 0,
    createdAt: new Date().toISOString(),
  });

  return {
    ok: true,
    task: {
      taskId,
      maxBudget,
      bidDeadline,
      submissionWindow,
      budgetReasoning: derived?.reasoning ?? null,
      transactions: [approveTx, postTx],
    },
  };
}

export interface SelectWinnerResult {
  transaction: RelayedTransaction;
  bidId: number;
  workerAddress: string;
  /** Present when the winner was chosen here from live subgraph signals rather than supplied. */
  selection: BidSelectionResult | null;
}

/**
 * Assigns a task. With no `bidId` the winner comes from subgraph-informed scoring (D1) — the
 * contract does not force lowest-bid-wins.
 */
export async function selectWinner(
  taskId: number,
  bidId?: number,
): Promise<OpResult<SelectWinnerResult>> {
  if (!(await getTask(taskId))) {
    return { ok: false, status: 404, error: "Task not found" };
  }

  const onChain = await readOnChainTask(taskId);
  if (onChain.state !== 1) {
    return { ok: false, status: 409, error: `Task is ${onChain.stateLabel}; select requires Bidding` };
  }
  if (nowSeconds() <= onChain.bidDeadline) {
    return { ok: false, status: 409, error: "Bid deadline has not passed yet" };
  }

  let selection: BidSelectionResult | null = null;
  let chosenBidId: number;
  let workerAddress: string;

  if (bidId === undefined) {
    const bids = await listBidsForTask(taskId, onChain.round);
    selection = await scoreBids(bids, onChain.maxBudget);
    console.log(`[agent] task ${taskId} bid selection: ${selection.reasoning.message}`);
    if (!selection.winner) {
      return {
        ok: false,
        status: 409,
        error: selection.reasoning.message,
        selection,
      };
    }
    chosenBidId = selection.winner.bidId;
    workerAddress = selection.winner.workerAddress;
  } else {
    const bid = await getBid(bidId);
    if (!bid || bid.taskId !== taskId || bid.round !== onChain.round) {
      return { ok: false, status: 400, error: "Invalid bid for this task and round" };
    }
    chosenBidId = bid.id;
    workerAddress = bid.workerAddress;
  }

  const tx = await enqueueContractCall({
    walletId: requireEnv("CIRCLE_AGENT_WALLET_ID"),
    kind: "select_winner",
    expectedEvent: "WorkerAssigned",
    contractAddress: getEscrowAddress(),
    abiFunctionSignature: "selectWinner(uint256,uint256)",
    abiParameters: [taskId, chosenBidId],
    taskId,
    round: onChain.round,
    worker: workerAddress,
  });
  if (tx.status === "failed") return { ...failed(tx, "selectWinner"), selection: selection ?? undefined };

  return { ok: true, transaction: tx, bidId: chosenBidId, workerAddress, selection };
}

async function settleSubmittedWork(
  taskId: number,
  approve: boolean,
): Promise<OpResult<{ transaction: RelayedTransaction }>> {
  if (!(await getTask(taskId))) {
    return { ok: false, status: 404, error: "Task not found" };
  }

  const onChain = await readOnChainTask(taskId);
  if (onChain.state !== 3) {
    const verb = approve ? "approve" : "reject";
    return {
      ok: false,
      status: 409,
      error: `Task is ${onChain.stateLabel}; ${verb} requires Submitted`,
    };
  }

  const label = approve ? "approveWork" : "rejectWork";
  const tx = await enqueueContractCall({
    walletId: requireEnv("CIRCLE_AGENT_WALLET_ID"),
    kind: approve ? "approve_work" : "reject_work",
    expectedEvent: approve ? "PaymentReleased" : "WorkRejected",
    contractAddress: getEscrowAddress(),
    abiFunctionSignature: `${label}(uint256)`,
    abiParameters: [taskId],
    taskId,
    round: onChain.round,
    worker: onChain.assignedWorker,
  });
  if (tx.status === "failed") return failed(tx, label);

  return { ok: true, transaction: tx };
}

/** Releases escrowed USDC to the worker's self-custodied address. */
export function approveWork(taskId: number) {
  return settleSubmittedWork(taskId, true);
}

/** Sends the task back to Assigned with a refreshed submission deadline (D5). */
export function rejectWork(taskId: number) {
  return settleSubmittedWork(taskId, false);
}

/** Reopens bidding after a missed submission deadline. Escrow stays locked (D5). */
export async function reclaimTask(
  taskId: number,
  newBidDeadlineSeconds: number,
): Promise<OpResult<{ transaction: RelayedTransaction; round: number }>> {
  if (!Number.isFinite(newBidDeadlineSeconds) || newBidDeadlineSeconds <= 0) {
    return { ok: false, status: 400, error: "newBidDeadlineSeconds must be a positive number" };
  }
  const stored = await getTask(taskId);
  if (!stored) {
    return { ok: false, status: 404, error: "Task not found" };
  }

  const onChain = await readOnChainTask(taskId);
  if (onChain.state !== 2) {
    return { ok: false, status: 409, error: `Task is ${onChain.stateLabel}; reclaim requires Assigned` };
  }
  if (nowSeconds() <= onChain.submissionDeadline) {
    return { ok: false, status: 409, error: "Submission deadline has not passed yet" };
  }

  const newBidDeadline = nowSeconds() + BigInt(Math.floor(newBidDeadlineSeconds));
  const tx = await enqueueContractCall({
    walletId: requireEnv("CIRCLE_AGENT_WALLET_ID"),
    kind: "reclaim_task",
    expectedEvent: "TaskReclaimed",
    contractAddress: getEscrowAddress(),
    abiFunctionSignature: "reclaimTask(uint256,uint256)",
    abiParameters: [taskId, newBidDeadline.toString()],
    taskId,
    round: onChain.round,
  });
  if (tx.status === "failed") return failed(tx, "reclaimTask");

  const nextRound = onChain.round + 1;
  await upsertTask({
    ...stored,
    round: nextRound,
    bidDeadline: newBidDeadline.toString(),
    state: 0,
  });

  return { ok: true, transaction: tx, round: nextRound };
}

/**
 * Closes an open task and refunds the agent. `cancelTask` only applies once bidding has closed
 * with no bids; anything else has to go through `abortTask`.
 */
export async function cancelTask(
  taskId: number,
): Promise<OpResult<{ transaction: RelayedTransaction; aborted: boolean }>> {
  if (!(await getTask(taskId))) {
    return { ok: false, status: 404, error: "Task not found" };
  }

  const onChain = await readOnChainTask(taskId);
  if (onChain.state !== 0 && onChain.state !== 1) {
    return {
      ok: false,
      status: 409,
      error: `Task is ${onChain.stateLabel}; cancel requires Open or Bidding`,
    };
  }

  const aborted = onChain.currentRoundBidCount > 0n || nowSeconds() <= onChain.bidDeadline;
  const label = aborted ? "abortTask" : "cancelTask";
  const tx = await enqueueContractCall({
    walletId: requireEnv("CIRCLE_AGENT_WALLET_ID"),
    kind: aborted ? "abort_task" : "cancel_task",
    expectedEvent: "TaskCancelled",
    contractAddress: getEscrowAddress(),
    abiFunctionSignature: `${label}(uint256)`,
    abiParameters: [taskId],
    taskId,
    round: onChain.round,
  });
  if (tx.status === "failed") return failed(tx, label);

  return { ok: true, transaction: tx, aborted };
}
