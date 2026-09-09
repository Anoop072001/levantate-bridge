import type { IncomingMessage, ServerResponse } from "node:http";
import { keccak256, toBytes } from "viem";
import { readUsdcBalance } from "../chain/usdc-balance.js";
import { createArcPublicClient, getEscrowAddress, getEscrowContract, getUsdcAddress } from "../chain/escrow.js";
import { nowSeconds, readOnChainTask } from "../chain/task-state.js";
import { requireEnv } from "../env.js";
import { enqueueContractCall, pendingHandle } from "../relayer/submit.js";
import {
  findWorkerByNullifier,
  getBid,
  getProof,
  getRelayedTransaction,
  getTask,
  insertBid,
  listBidsForTask,
  listTasks,
  upsertProof,
  upsertTask,
  type TaskRecord,
} from "../store.js";

async function enrichTask(t: TaskRecord, client: ReturnType<typeof createArcPublicClient>) {
  const onChain = await readOnChainTask(t.id, client);
  return {
    ...t,
    bidDeadline: onChain.bidDeadline.toString(),
    submissionWindow: onChain.submissionWindow.toString(),
    submissionDeadline: onChain.submissionDeadline.toString(),
    round: onChain.round,
    state: onChain.state,
    stateLabel: onChain.stateLabel,
    assignedWorker: onChain.assignedWorker,
    currentRoundBidCount: onChain.currentRoundBidCount.toString(),
    maxBudget: onChain.maxBudget.toString(),
  };
}

async function agentContractCall(
  json: (status: number, payload: unknown) => void,
  input: Parameters<typeof enqueueContractCall>[0],
  errorLabel: string,
) {
  const tx = await enqueueContractCall(input);
  if (tx.status === "failed") {
    json(502, { error: `${errorLabel} failed`, ...pendingHandle(tx) });
    return null;
  }
  json(202, pendingHandle(tx));
  return tx;
}

export async function handleTasksRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  json: (status: number, payload: unknown) => void,
): Promise<boolean> {
  const client = createArcPublicClient();
  const escrowAddress = getEscrowAddress();
  const usdcAddress = getUsdcAddress();
  const agentWalletId = requireEnv("CIRCLE_AGENT_WALLET_ID");
  const relayerWalletId = requireEnv("CIRCLE_RELAYER_WALLET_ID");

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const stored = listTasks();
    const enriched = await Promise.all(stored.map((t) => enrichTask(t, client)));
    json(200, { tasks: enriched });
    return true;
  }

  const taskDetailMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (req.method === "GET" && taskDetailMatch) {
    const taskId = Number(taskDetailMatch[1]);
    const stored = getTask(taskId);
    if (!stored) {
      json(404, { error: "Task not found" });
      return true;
    }
    json(200, { task: await enrichTask(stored, client) });
    return true;
  }

  const workerBalanceMatch = url.pathname.match(/^\/api\/workers\/(0x[a-fA-F0-9]{40})\/balance$/);
  if (req.method === "GET" && workerBalanceMatch) {
    const address = workerBalanceMatch[1] as `0x${string}`;
    const balance = await readUsdcBalance(address, client);
    json(200, { address, usdcBalance: balance.toString() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const input = body as {
      description?: string;
      maxBudget?: number;
      bidDeadlineSeconds?: number;
      submissionWindowSeconds?: number;
    };
    if (!input.description || !input.maxBudget || !input.bidDeadlineSeconds || !input.submissionWindowSeconds) {
      json(400, { error: "description, maxBudget, bidDeadlineSeconds, submissionWindowSeconds required" });
      return true;
    }

    const maxBudget = BigInt(input.maxBudget);
    const bidDeadline = BigInt(Math.floor(Date.now() / 1000) + input.bidDeadlineSeconds);
    const submissionWindow = BigInt(input.submissionWindowSeconds);

    const nextId = (await client.readContract({
      address: escrowAddress,
      abi: [{ name: "nextTaskId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
      functionName: "nextTaskId",
    })) as bigint;
    const taskId = Number(nextId);

    const approveTx = await enqueueContractCall({
      walletId: agentWalletId,
      kind: "usdc_approve",
      expectedEvent: "Approval",
      contractAddress: usdcAddress,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [escrowAddress, maxBudget.toString()],
    });
    if (approveTx.status === "failed") {
      json(502, { error: "USDC approve failed", ...pendingHandle(approveTx) });
      return true;
    }

    const postTx = await enqueueContractCall({
      walletId: agentWalletId,
      kind: "post_task",
      expectedEvent: "TaskPosted",
      contractAddress: escrowAddress,
      abiFunctionSignature: "postTask(string,uint256,uint256,uint256)",
      abiParameters: [input.description, maxBudget.toString(), bidDeadline.toString(), submissionWindow.toString()],
      taskId,
      round: 0,
    });
    if (postTx.status === "failed") {
      json(502, { error: "postTask failed", ...pendingHandle(postTx) });
      return true;
    }

    upsertTask({
      id: taskId,
      description: input.description,
      maxBudget: maxBudget.toString(),
      bidDeadline: bidDeadline.toString(),
      submissionWindow: submissionWindow.toString(),
      round: 0,
      state: 0,
      createdAt: new Date().toISOString(),
    });

    json(202, { taskId, transactions: [pendingHandle(approveTx), pendingHandle(postTx)] });
    return true;
  }

  const bidMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/bids$/);
  if (req.method === "POST" && bidMatch) {
    const taskId = Number(bidMatch[1]);
    const input = body as { nullifierHash?: string; amount?: number };
    if (!input.nullifierHash || !input.amount) {
      json(400, { error: "nullifierHash and amount required" });
      return true;
    }

    const worker = findWorkerByNullifier(input.nullifierHash);
    if (!worker) {
      json(403, { error: "Worker not verified" });
      return true;
    }

    const task = getTask(taskId);
    if (!task) {
      json(404, { error: "Task not found" });
      return true;
    }

    const onChain = await readOnChainTask(taskId, client);
    if (onChain.state !== 0 && onChain.state !== 1) {
      json(409, { error: `Task is ${onChain.stateLabel}; bids only allowed in Open or Bidding` });
      return true;
    }
    if (nowSeconds() > onChain.bidDeadline) {
      json(409, { error: "Bid deadline has passed" });
      return true;
    }
    if (BigInt(input.amount) > onChain.maxBudget) {
      json(400, { error: "Bid exceeds max budget" });
      return true;
    }

    const amountStr = BigInt(input.amount).toString();
    const duplicate = listBidsForTask(taskId, onChain.round).some(
      (b) =>
        b.workerAddress.toLowerCase() === worker.address.toLowerCase() && b.amount === amountStr,
    );
    if (duplicate) {
      json(409, { error: "You already placed a bid for this amount on this task" });
      return true;
    }

    const nextBidId = (await client.readContract({
      address: escrowAddress,
      abi: [{ name: "nextBidId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
      functionName: "nextBidId",
    })) as bigint;

    const tx = await enqueueContractCall({
      walletId: relayerWalletId,
      kind: "place_bid",
      expectedEvent: "BidPlaced",
      contractAddress: escrowAddress,
      abiFunctionSignature: "placeBid(uint256,address,uint256)",
      abiParameters: [taskId, worker.address, BigInt(input.amount).toString()],
      taskId,
      round: onChain.round,
      worker: worker.address,
    });

    if (tx.status === "failed") {
      json(502, { error: "placeBid failed", ...pendingHandle(tx) });
      return true;
    }

    insertBid({
      id: Number(nextBidId),
      taskId,
      round: onChain.round,
      workerAddress: worker.address,
      nullifierHash: input.nullifierHash,
      amount: BigInt(input.amount).toString(),
      createdAt: new Date().toISOString(),
    });

    json(202, pendingHandle(tx));
    return true;
  }

  const proofMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/proof$/);
  if (req.method === "GET" && proofMatch) {
    const taskId = Number(proofMatch[1]);
    const round = Number(url.searchParams.get("round") ?? "0");
    const proof = getProof(taskId, round);
    if (!proof) {
      json(404, { error: "Proof not found" });
      return true;
    }
    json(200, {
      ...proof,
      recomputedHash: keccak256(toBytes(proof.content)),
    });
    return true;
  }

  const submitMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/submit$/);
  if (req.method === "POST" && submitMatch) {
    const taskId = Number(submitMatch[1]);
    const input = body as { nullifierHash?: string; content?: string; link?: string };
    if (!input.nullifierHash || !input.content) {
      json(400, { error: "nullifierHash and content required" });
      return true;
    }

    const worker = findWorkerByNullifier(input.nullifierHash);
    if (!worker) {
      json(403, { error: "Worker not verified" });
      return true;
    }

    const task = getTask(taskId);
    if (!task) {
      json(404, { error: "Task not found" });
      return true;
    }

    const onChain = await readOnChainTask(taskId, client);
    if (onChain.state !== 2) {
      json(409, { error: `Task is ${onChain.stateLabel}; submit only allowed when Assigned` });
      return true;
    }
    if (nowSeconds() > onChain.submissionDeadline) {
      json(409, { error: "Submission deadline has passed" });
      return true;
    }
    if (onChain.assignedWorker.toLowerCase() !== worker.address.toLowerCase()) {
      json(403, { error: "Worker is not assigned to this task" });
      return true;
    }

    const payload = input.link ? `${input.content}\n${input.link}` : input.content;
    const proofHash = keccak256(toBytes(payload));

    const tx = await enqueueContractCall({
      walletId: relayerWalletId,
      kind: "submit_work",
      expectedEvent: "WorkSubmitted",
      contractAddress: escrowAddress,
      abiFunctionSignature: "submitWork(uint256,bytes32)",
      abiParameters: [taskId, proofHash],
      taskId,
      round: onChain.round,
      worker: worker.address,
    });

    if (tx.status === "failed") {
      json(502, { error: "submitWork failed", ...pendingHandle(tx) });
      return true;
    }

    upsertProof({
      taskId,
      round: onChain.round,
      content: payload,
      contentHash: proofHash,
      createdAt: new Date().toISOString(),
    });

    json(202, pendingHandle(tx));
    return true;
  }

  const bidsListMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/bids$/);
  if (req.method === "GET" && bidsListMatch) {
    const taskId = Number(bidsListMatch[1]);
    if (!getTask(taskId)) {
      json(404, { error: "Task not found" });
      return true;
    }
    const round = url.searchParams.has("round")
      ? Number(url.searchParams.get("round"))
      : (await readOnChainTask(taskId, client)).round;
    json(200, { bids: listBidsForTask(taskId, round) });
    return true;
  }

  const selectMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/select$/);
  if (req.method === "POST" && selectMatch) {
    const taskId = Number(selectMatch[1]);
    const input = body as { bidId?: number };
    if (input.bidId === undefined) {
      json(400, { error: "bidId required" });
      return true;
    }
    if (!getTask(taskId)) {
      json(404, { error: "Task not found" });
      return true;
    }

    const onChain = await readOnChainTask(taskId, client);
    if (onChain.state !== 1) {
      json(409, { error: `Task is ${onChain.stateLabel}; select requires Bidding` });
      return true;
    }
    if (nowSeconds() <= onChain.bidDeadline) {
      json(409, { error: "Bid deadline has not passed yet" });
      return true;
    }

    const bid = getBid(input.bidId);
    if (!bid || bid.taskId !== taskId || bid.round !== onChain.round) {
      json(400, { error: "Invalid bid for this task and round" });
      return true;
    }

    await agentContractCall(
      json,
      {
        walletId: agentWalletId,
        kind: "select_winner",
        expectedEvent: "WorkerAssigned",
        contractAddress: escrowAddress,
        abiFunctionSignature: "selectWinner(uint256,uint256)",
        abiParameters: [taskId, input.bidId],
        taskId,
        round: onChain.round,
        worker: bid.workerAddress,
      },
      "selectWinner",
    );
    return true;
  }

  const approveMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const taskId = Number(approveMatch[1]);
    if (!getTask(taskId)) {
      json(404, { error: "Task not found" });
      return true;
    }

    const onChain = await readOnChainTask(taskId, client);
    if (onChain.state !== 3) {
      json(409, { error: `Task is ${onChain.stateLabel}; approve requires Submitted` });
      return true;
    }

    await agentContractCall(
      json,
      {
        walletId: agentWalletId,
        kind: "approve_work",
        expectedEvent: "PaymentReleased",
        contractAddress: escrowAddress,
        abiFunctionSignature: "approveWork(uint256)",
        abiParameters: [taskId],
        taskId,
        round: onChain.round,
        worker: onChain.assignedWorker,
      },
      "approveWork",
    );
    return true;
  }

  const rejectMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const taskId = Number(rejectMatch[1]);
    if (!getTask(taskId)) {
      json(404, { error: "Task not found" });
      return true;
    }

    const onChain = await readOnChainTask(taskId, client);
    if (onChain.state !== 3) {
      json(409, { error: `Task is ${onChain.stateLabel}; reject requires Submitted` });
      return true;
    }

    await agentContractCall(
      json,
      {
        walletId: agentWalletId,
        kind: "reject_work",
        expectedEvent: "WorkRejected",
        contractAddress: escrowAddress,
        abiFunctionSignature: "rejectWork(uint256)",
        abiParameters: [taskId],
        taskId,
        round: onChain.round,
        worker: onChain.assignedWorker,
      },
      "rejectWork",
    );
    return true;
  }

  const reclaimMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/reclaim$/);
  if (req.method === "POST" && reclaimMatch) {
    const taskId = Number(reclaimMatch[1]);
    const input = body as { newBidDeadlineSeconds?: number };
    if (!input.newBidDeadlineSeconds) {
      json(400, { error: "newBidDeadlineSeconds required" });
      return true;
    }
    if (!getTask(taskId)) {
      json(404, { error: "Task not found" });
      return true;
    }

    const onChain = await readOnChainTask(taskId, client);
    if (onChain.state !== 2) {
      json(409, { error: `Task is ${onChain.stateLabel}; reclaim requires Assigned` });
      return true;
    }
    if (nowSeconds() <= onChain.submissionDeadline) {
      json(409, { error: "Submission deadline has not passed yet" });
      return true;
    }

    const newBidDeadline = BigInt(Math.floor(Date.now() / 1000) + input.newBidDeadlineSeconds);
    const tx = await enqueueContractCall({
      walletId: agentWalletId,
      kind: "reclaim_task",
      expectedEvent: "TaskReclaimed",
      contractAddress: escrowAddress,
      abiFunctionSignature: "reclaimTask(uint256,uint256)",
      abiParameters: [taskId, newBidDeadline.toString()],
      taskId,
      round: onChain.round,
    });

    if (tx.status === "failed") {
      json(502, { error: "reclaimTask failed", ...pendingHandle(tx) });
      return true;
    }

    const stored = getTask(taskId)!;
    upsertTask({
      ...stored,
      round: onChain.round + 1,
      bidDeadline: newBidDeadline.toString(),
      state: 0,
    });

    json(202, pendingHandle(tx));
    return true;
  }

  const cancelMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const taskId = Number(cancelMatch[1]);
    if (!getTask(taskId)) {
      json(404, { error: "Task not found" });
      return true;
    }

    const onChain = await readOnChainTask(taskId, client);
    if (onChain.state !== 0 && onChain.state !== 1) {
      json(409, { error: `Task is ${onChain.stateLabel}; cancel requires Open or Bidding` });
      return true;
    }

    const useAbort =
      onChain.currentRoundBidCount > 0n || nowSeconds() <= onChain.bidDeadline;

    if (useAbort) {
      await agentContractCall(
        json,
        {
          walletId: agentWalletId,
          kind: "abort_task",
          expectedEvent: "TaskCancelled",
          contractAddress: escrowAddress,
          abiFunctionSignature: "abortTask(uint256)",
          abiParameters: [taskId],
          taskId,
          round: onChain.round,
        },
        "abortTask",
      );
      return true;
    }

    await agentContractCall(
      json,
      {
        walletId: agentWalletId,
        kind: "cancel_task",
        expectedEvent: "TaskCancelled",
        contractAddress: escrowAddress,
        abiFunctionSignature: "cancelTask(uint256)",
        abiParameters: [taskId],
        taskId,
        round: onChain.round,
      },
      "cancelTask",
    );
    return true;
  }

  const txMatch = url.pathname.match(/^\/api\/transactions\/([0-9a-f-]+)$/);
  if (req.method === "GET" && txMatch) {
    const tx = getRelayedTransaction(txMatch[1]);
    if (!tx) {
      json(404, { error: "Transaction not found" });
      return true;
    }
    json(200, pendingHandle(tx));
    return true;
  }

  return false;
}
