import { createArcPublicClient, getEscrowAddress, getUsdcAddress } from "../chain/escrow.js";
import { nowSeconds, readOnChainTask } from "../chain/task-state.js";
import { requireEnv } from "../env.js";
import { enqueueContractCall, type RelayedTransaction } from "../relayer/submit.js";
import {
  getProof,
  getTask,
  listBidsForTask,
  listTasks,
  upsertTask,
  type BidRecord,
} from "../store.js";
import { deriveTaskParams } from "./budget.js";
import { evaluateProof, isProofEvaluationAvailable } from "./proof-evaluator.js";
import { scoreBids } from "./score-bids.js";

export interface AgentAction {
  kind: "select_winner" | "approve_work" | "reject_work" | "reclaim_task";
  taskId: number;
  reasoning: unknown;
  transaction?: RelayedTransaction;
  error?: string;
}

export interface AgentRunResult {
  actions: AgentAction[];
  timestamp: string;
}

async function selectWinnerForTask(taskId: number, round: number, maxBudget: bigint): Promise<AgentAction> {
  const bids = listBidsForTask(taskId, round);
  const selection = await scoreBids(bids, maxBudget);
  console.log(`[agent] task ${taskId} bid selection: ${selection.reasoning.message}`);

  if (!selection.winner) {
    return {
      kind: "select_winner",
      taskId,
      reasoning: { selection, action: "skipped_no_winner" },
    };
  }

  const agentWalletId = requireEnv("CIRCLE_AGENT_WALLET_ID");
  const tx = await enqueueContractCall({
    walletId: agentWalletId,
    kind: "select_winner",
    expectedEvent: "WorkerAssigned",
    contractAddress: getEscrowAddress(),
    abiFunctionSignature: "selectWinner(uint256,uint256)",
    abiParameters: [taskId, selection.winner.bidId],
    taskId,
    round,
    worker: selection.winner.workerAddress,
  });

  return {
    kind: "select_winner",
    taskId,
    reasoning: { selection },
    transaction: tx,
    error: tx.status === "failed" ? tx.error : undefined,
  };
}

async function evaluateSubmittedTask(taskId: number): Promise<AgentAction> {
  const stored = getTask(taskId);
  if (!stored) {
    return { kind: "approve_work", taskId, reasoning: {}, error: "Task not in store" };
  }

  const client = createArcPublicClient();
  const onChain = await readOnChainTask(taskId, client);
  const proof = getProof(taskId, onChain.round);
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

  console.log(`[agent] task ${taskId} proof verdict: ${verdict.approved ? "APPROVE" : "REJECT"} — ${verdict.reason}`);

  const agentWalletId = requireEnv("CIRCLE_AGENT_WALLET_ID");
  const kind = verdict.approved ? "approve_work" : "reject_work";
  const expectedEvent = verdict.approved ? "PaymentReleased" : "WorkRejected";
  const signature = verdict.approved ? "approveWork(uint256)" : "rejectWork(uint256)";

  const tx = await enqueueContractCall({
    walletId: agentWalletId,
    kind,
    expectedEvent,
    contractAddress: getEscrowAddress(),
    abiFunctionSignature: signature,
    abiParameters: [taskId],
    taskId,
    round: onChain.round,
    worker: onChain.assignedWorker,
  });

  return {
    kind: verdict.approved ? "approve_work" : "reject_work",
    taskId,
    reasoning: { verdict },
    transaction: tx,
    error: tx.status === "failed" ? tx.error : undefined,
  };
}

async function reclaimTask(taskId: number, round: number): Promise<AgentAction> {
  const newBidDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const agentWalletId = requireEnv("CIRCLE_AGENT_WALLET_ID");

  console.log(`[agent] task ${taskId} reclaiming — submission deadline passed`);

  const tx = await enqueueContractCall({
    walletId: agentWalletId,
    kind: "reclaim_task",
    expectedEvent: "TaskReclaimed",
    contractAddress: getEscrowAddress(),
    abiFunctionSignature: "reclaimTask(uint256,uint256)",
    abiParameters: [taskId, newBidDeadline.toString()],
    taskId,
    round,
  });

  return {
    kind: "reclaim_task",
    taskId,
    reasoning: { newBidDeadline: newBidDeadline.toString(), message: "Submission deadline passed" },
    transaction: tx,
    error: tx.status === "failed" ? tx.error : undefined,
  };
}

export async function runAgentCycle(): Promise<AgentRunResult> {
  const client = createArcPublicClient();
  const actions: AgentAction[] = [];
  const stored = listTasks();

  for (const task of stored) {
    const onChain = await readOnChainTask(task.id, client);
    const now = nowSeconds();

    if (onChain.state === 1 && now > onChain.bidDeadline) {
      const bids = listBidsForTask(task.id, onChain.round);
      if (bids.length > 0) {
        actions.push(await selectWinnerForTask(task.id, onChain.round, onChain.maxBudget));
      }
    }

    if (onChain.state === 3) {
      if (!isProofEvaluationAvailable()) {
        console.log(`[agent] task ${task.id} submitted — skipping proof evaluation (no LLM API key)`);
      } else {
        actions.push(await evaluateSubmittedTask(task.id));
      }
    }

    if (onChain.state === 2 && now > onChain.submissionDeadline) {
      actions.push(await reclaimTask(task.id, onChain.round));
    }
  }

  return { actions, timestamp: new Date().toISOString() };
}

export async function agentPostTask(description: string, bidDeadlineSeconds: number): Promise<{
  taskId: number;
  params: Awaited<ReturnType<typeof deriveTaskParams>>;
  transactions: RelayedTransaction[];
}> {
  const client = createArcPublicClient();
  const escrowAddress = getEscrowAddress();
  const usdcAddress = getUsdcAddress();
  const agentWalletId = requireEnv("CIRCLE_AGENT_WALLET_ID");

  const params = await deriveTaskParams();
  console.log(
    `[agent] posting task — budget=${params.maxBudget}, submissionWindow=${params.submissionWindow}, ` +
      `medianPaid=${params.reasoning.medianPaidAmount ?? "none"}`,
  );

  const nextId = (await client.readContract({
    address: escrowAddress,
    abi: [{ name: "nextTaskId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
    functionName: "nextTaskId",
  })) as bigint;
  const taskId = Number(nextId);

  const bidDeadline = BigInt(Math.floor(Date.now() / 1000) + bidDeadlineSeconds);

  const approveTx = await enqueueContractCall({
    walletId: agentWalletId,
    kind: "usdc_approve",
    expectedEvent: "Approval",
    contractAddress: usdcAddress,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [escrowAddress, params.maxBudget.toString()],
  });
  if (approveTx.status === "failed") {
    throw new Error(`USDC approve failed: ${approveTx.error}`);
  }

  const postTx = await enqueueContractCall({
    walletId: agentWalletId,
    kind: "post_task",
    expectedEvent: "TaskPosted",
    contractAddress: escrowAddress,
    abiFunctionSignature: "postTask(string,uint256,uint256,uint256)",
    abiParameters: [
      description,
      params.maxBudget.toString(),
      bidDeadline.toString(),
      params.submissionWindow.toString(),
    ],
    taskId,
    round: 0,
  });
  if (postTx.status === "failed") {
    throw new Error(`postTask failed: ${postTx.error}`);
  }

  upsertTask({
    id: taskId,
    description,
    maxBudget: params.maxBudget.toString(),
    bidDeadline: bidDeadline.toString(),
    submissionWindow: params.submissionWindow.toString(),
    round: 0,
    state: 0,
    createdAt: new Date().toISOString(),
  });

  return { taskId, params, transactions: [approveTx, postTx] };
}

export { deriveTaskParams, scoreBids };
export type { BidRecord };
