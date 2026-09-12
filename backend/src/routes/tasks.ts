import type { IncomingMessage, ServerResponse } from "node:http";
import { proofHash, parseProofContent } from "../proof/payload.js";
import { describeProofForApi } from "../proof/describe.js";
import { resolveProofFileDownload } from "../proof/serve-download.js";
import { handleSubmitWork } from "../proof/submit-work.js";
import { readUsdcBalance } from "../chain/usdc-balance.js";
import { createArcPublicClient, getEscrowAddress } from "../chain/escrow.js";
import { nowSeconds, readOnChainTask } from "../chain/task-state.js";
import { enrichAllTasks, enrichTaskWithActivity } from "../chain/task-view.js";
import { requireEnv } from "../env.js";
import { enqueueContractCall, pendingHandle } from "../relayer/submit.js";
import type { OpFailure } from "../agent/operations.js";
import {
  deleteLinkedWallet,
  findLinkedWallet,
  findWorkerByAddress,
  findWorkerByNullifier,
  getProof,
  getRelayedTransaction,
  getTask,
  insertBid,
  insertWorker,
  listBidsForTask,
  listTasks,
} from "../store.js";
import { verifySelfieCheck } from "../world-id/verify.js";

/**
 * Binds a Selfie Check proof to one specific bid. Mirrored in `frontend/lib/bid-signal.ts` —
 * the two must stay identical or bids will be rejected.
 */
export function bidSignal(taskId: number, round: number, amountMicro: string): string {
  return `bid:${taskId}:${round}:${amountMicro}`;
}

/** A rejected operation keeps its transaction handle when one exists, per D6. */
function respondFailure(
  json: (status: number, payload: unknown) => void,
  failure: OpFailure,
): void {
  if (failure.transaction) {
    json(failure.status, { ...pendingHandle(failure.transaction), error: failure.error });
    return;
  }
  json(failure.status, { error: failure.error });
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
  const relayerWalletId = requireEnv("CIRCLE_RELAYER_WALLET_ID");

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const stored = await listTasks();
    json(200, { tasks: await enrichAllTasks(stored, client) });
    return true;
  }

  const taskDetailMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (req.method === "GET" && taskDetailMatch) {
    const taskId = Number(taskDetailMatch[1]);
    const stored = await getTask(taskId);
    if (!stored) {
      json(404, { error: "Task not found" });
      return true;
    }
    json(200, { task: await enrichTaskWithActivity(stored, client) });
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

    const { postTask } = await import("../agent/operations.js");
    const result = await postTask({
      description: input.description,
      bidDeadlineSeconds: input.bidDeadlineSeconds,
      submissionWindowSeconds: input.submissionWindowSeconds,
      maxBudgetMicro: BigInt(input.maxBudget).toString(),
    });
    if (!result.ok) {
      respondFailure(json, result);
      return true;
    }

    json(202, {
      taskId: result.task.taskId,
      transactions: result.task.transactions.map(pendingHandle),
    });
    return true;
  }

  const bidMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/bids$/);
  if (req.method === "POST" && bidMatch) {
    const taskId = Number(bidMatch[1]);
    const input = body as {
      amount?: number;
      rp_id?: string;
      idkitResponse?: Record<string, unknown>;
      signal?: string;
      signal_token?: string;
      walletAddress?: string;
      linkToken?: string;
    };
    if (!input.amount) {
      json(400, { error: "amount required" });
      return true;
    }
    if (!input.idkitResponse || !input.signal || !input.signal_token) {
      json(400, {
        error: "A Selfie Check proof is required to bid — idkitResponse, signal, and signal_token",
      });
      return true;
    }

    const task = await getTask(taskId);
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

    // Cheap checks first so a rejected bid never burns the worker's Selfie Check.
    const amountStr = BigInt(input.amount).toString();
    const expectedSignal = bidSignal(taskId, onChain.round, amountStr);
    if (input.signal !== expectedSignal) {
      json(400, { error: "Selfie Check proof was issued for a different task, round, or amount" });
      return true;
    }

    const walletAddress = input.walletAddress?.trim();
    const linkToken = input.linkToken?.trim();

    if (walletAddress) {
      const duplicateHint = (await listBidsForTask(taskId, onChain.round)).some(
        (b) =>
          b.workerAddress.toLowerCase() === walletAddress.toLowerCase() && b.amount === amountStr,
      );
      if (duplicateHint) {
        json(409, { error: "You already placed a bid for this amount on this task" });
        return true;
      }
    }

    const existingWorker = walletAddress ? await findWorkerByAddress(walletAddress) : undefined;
    if (!existingWorker) {
      if (!walletAddress || !linkToken) {
        json(403, {
          error:
            "Link a payout wallet before Selfie Check — your first bid binds that address to your World ID",
        });
        return true;
      }

      const linked = await findLinkedWallet(walletAddress, linkToken);
      if (!linked) {
        json(403, { error: "Wallet link expired or invalid — connect your wallet and sign again" });
        return true;
      }
    }

    const proof = await verifySelfieCheck({
      rpId: input.rp_id ?? requireEnv("WORLD_RP_ID"),
      idkitResponse: input.idkitResponse,
      signal: input.signal,
      signalToken: input.signal_token,
      taskId,
    });
    if (!proof.ok) {
      json(proof.status, { error: proof.error, detail: proof.detail });
      return true;
    }

    // Identity is read out of the proof. A stored session cannot bid for someone else.
    let worker = await findWorkerByNullifier(proof.nullifierHash);
    if (
      worker &&
      walletAddress &&
      worker.address.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      json(409, {
        error: `Your World ID is registered to payout address ${worker.address}. Bids always use that address on-chain. Connect it in your wallet, or complete "Change payout wallet" on /wallet before bidding with a new address.`,
        registeredAddress: worker.address,
        nullifierHash: worker.nullifierHash,
      });
      return true;
    }
    if (!worker) {
      // Wallet link was validated before verifySelfieCheck so a spent proof is never wasted here.
      if (!walletAddress || !linkToken) {
        json(403, {
          error:
            "Link a payout wallet before Selfie Check — your first bid binds that address to your World ID",
        });
        return true;
      }

      const addressTaken = await findWorkerByAddress(walletAddress);
      if (addressTaken) {
        json(409, { error: "This wallet is already bound to a different World ID" });
        return true;
      }

      await insertWorker({
        nullifierHash: proof.nullifierHash,
        address: walletAddress,
        signal: input.signal,
        createdAt: new Date().toISOString(),
      });
      await deleteLinkedWallet(walletAddress);
      worker = {
        nullifierHash: proof.nullifierHash,
        address: walletAddress,
        signal: input.signal,
        createdAt: new Date().toISOString(),
      };
    }

    const duplicate = (await listBidsForTask(taskId, onChain.round)).some(
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
      json(502, { ...pendingHandle(tx), error: tx.error ?? "placeBid failed" });
      return true;
    }

    await insertBid({
      id: Number(nextBidId),
      taskId,
      round: onChain.round,
      workerAddress: worker.address,
      nullifierHash: proof.nullifierHash,
      amount: amountStr,
      createdAt: new Date().toISOString(),
    });

    json(202, {
      ...pendingHandle(tx),
      nullifierHash: proof.nullifierHash,
      walletAddress: worker.address,
      bidId: Number(nextBidId),
      amount: amountStr,
    });
    return true;
  }

  const proofDownloadMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/proof\/download$/);
  if (req.method === "GET" && proofDownloadMatch) {
    const taskId = Number(proofDownloadMatch[1]);
    const round = Number(url.searchParams.get("round") ?? "0");
    const proof = await getProof(taskId, round);
    if (!proof) {
      json(404, { error: "Proof not found" });
      return true;
    }
    try {
      const file = await resolveProofFileDownload(proof);
      const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
      res.writeHead(200, {
        "content-type": file.mimeType,
        "content-disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`,
        "content-length": String(file.bytes.length),
        "access-control-allow-origin": origin,
      });
      res.end(file.bytes);
    } catch (err) {
      json(400, { error: err instanceof Error ? err.message : "Proof download failed" });
    }
    return true;
  }

  const proofMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/proof$/);
  if (req.method === "GET" && proofMatch) {
    const taskId = Number(proofMatch[1]);
    const round = Number(url.searchParams.get("round") ?? "0");
    const proof = await getProof(taskId, round);
    if (!proof) {
      json(404, { error: "Proof not found" });
      return true;
    }
    const payload = parseProofContent(proof.content);
    json(200, {
      ...proof,
      submission: await describeProofForApi(proof),
      onChainHash: proof.contentHash,
      recomputedHash: payload.kind === "text" ? proofHash(payload) : proof.contentHash,
    });
    return true;
  }

  const submitMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/submit$/);
  if (req.method === "POST" && submitMatch) {
    const taskId = Number(submitMatch[1]);
    return handleSubmitWork(req, res, taskId, json, body);
  }

  const bidsListMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/bids$/);
  if (req.method === "GET" && bidsListMatch) {
    const taskId = Number(bidsListMatch[1]);
    if (!(await getTask(taskId))) {
      json(404, { error: "Task not found" });
      return true;
    }
    const round = url.searchParams.has("round")
      ? Number(url.searchParams.get("round"))
      : (await readOnChainTask(taskId, client)).round;
    json(200, { bids: await listBidsForTask(taskId, round) });
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

    const { selectWinner } = await import("../agent/operations.js");
    const result = await selectWinner(taskId, input.bidId);
    if (!result.ok) {
      respondFailure(json, result);
      return true;
    }
    if (result.transaction) {
      json(202, pendingHandle(result.transaction));
    } else {
      json(200, {
        alreadyAssigned: true,
        bidId: result.bidId,
        workerAddress: result.workerAddress,
      });
    }
    return true;
  }

  const approveMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const { approveWork } = await import("../agent/operations.js");
    const result = await approveWork(Number(approveMatch[1]));
    if (!result.ok) {
      respondFailure(json, result);
      return true;
    }
    json(202, pendingHandle(result.transaction));
    return true;
  }

  const rejectMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const { rejectWork } = await import("../agent/operations.js");
    const result = await rejectWork(Number(rejectMatch[1]));
    if (!result.ok) {
      respondFailure(json, result);
      return true;
    }
    json(202, pendingHandle(result.transaction));
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

    const { reclaimTask } = await import("../agent/operations.js");
    const result = await reclaimTask(taskId, input.newBidDeadlineSeconds);
    if (!result.ok) {
      respondFailure(json, result);
      return true;
    }
    json(202, pendingHandle(result.transaction));
    return true;
  }

  const cancelMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const { cancelTask } = await import("../agent/operations.js");
    const result = await cancelTask(Number(cancelMatch[1]));
    if (!result.ok) {
      respondFailure(json, result);
      return true;
    }
    json(202, pendingHandle(result.transaction));
    return true;
  }

  const txMatch = url.pathname.match(/^\/api\/transactions\/([0-9a-f-]+)$/);
  if (req.method === "GET" && txMatch) {
    const tx = await getRelayedTransaction(txMatch[1]);
    if (!tx) {
      json(404, { error: "Transaction not found" });
      return true;
    }
    json(200, pendingHandle(tx));
    return true;
  }

  return false;
}
