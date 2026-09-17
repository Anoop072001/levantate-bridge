import type { IncomingMessage, ServerResponse } from "node:http";
import { actorFromAgent, requireAgentAuth } from "../auth/agent.js";
import { pendingHandle } from "../relayer/submit.js";
import { getLiveTaskRecord } from "../chain/task-view.js";
import { listBidsForTask } from "../store.js";
import {
  checkAgentFunding,
  fundingHintPayload,
  readAgentUsdcBalance,
} from "../chain/agent-wallet.js";
import { createArcPublicClient } from "../chain/escrow.js";
import { readOnChainTask } from "../chain/task-state.js";

export async function handleAgentRoute(
  req: IncomingMessage,
  _res: ServerResponse,
  url: URL,
  body: unknown,
  json: (status: number, payload: unknown) => void,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/agent/wallet") {
    const agent = await requireAgentAuth(req, json);
    if (!agent) return true;
    try {
      const requiredParam = url.searchParams.get("requiredUsdc");
      const requiredMicro =
        requiredParam && Number(requiredParam) > 0
          ? BigInt(Math.round(Number(requiredParam) * 1_000_000))
          : 0n;
      const { address, balanceMicro } = await readAgentUsdcBalance(agent.address as `0x${string}`);
      const check =
        requiredMicro > 0n
          ? await checkAgentFunding(requiredMicro, address)
          : {
              agentAddress: address,
              balanceMicro,
              requiredMicro: 0n,
              sufficient: balanceMicro > 0n,
              faucetUrl: "https://faucet.circle.com",
            };
      json(200, {
        ...fundingHintPayload(check),
        sufficient: check.sufficient,
        balanceMicro: balanceMicro.toString(),
      });
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Agent wallet lookup failed" });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/agent/budget") {
    try {
      const { deriveTaskParams } = await import("../agent/budget.js");
      const params = await deriveTaskParams();
      json(200, {
        maxBudget: params.maxBudget.toString(),
        submissionWindow: params.submissionWindow.toString(),
        reasoning: params.reasoning,
      });
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Budget derivation failed" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/run-once") {
    const agent = await requireAgentAuth(req, json);
    if (!agent) return true;
    try {
      const { runAgentCycle } = await import("../agent/runner.js");
      const result = await runAgentCycle();
      json(200, result);
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Agent cycle failed" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/tasks") {
    const agent = await requireAgentAuth(req, json);
    if (!agent) return true;
    const input = body as {
      description?: string;
      bidDeadlineSeconds?: number;
      submissionWindowSeconds?: number;
    };
    if (!input.description) {
      json(400, { error: "description required" });
      return true;
    }
    const { postTask } = await import("../agent/operations.js");
    const result = await postTask(
      {
        description: input.description,
        bidDeadlineSeconds: input.bidDeadlineSeconds ?? 3600,
        submissionWindowSeconds: input.submissionWindowSeconds,
      },
      actorFromAgent(agent),
    );
    if (!result.ok) {
      json(result.status, {
        error: result.error,
        ...(result.funding ? { funding: result.funding } : {}),
      });
      return true;
    }
    json(202, {
      taskId: result.task.taskId,
      reasoning: result.task.budgetReasoning,
      maxBudget: result.task.maxBudget.toString(),
      submissionWindow: result.task.submissionWindow.toString(),
      transactions: result.task.transactions.map(pendingHandle),
    });
    return true;
  }

  const scoreMatch = url.pathname.match(/^\/api\/agent\/tasks\/(\d+)\/score-bids$/);
  if (req.method === "GET" && scoreMatch) {
    const taskId = Number(scoreMatch[1]);
    const stored = await getLiveTaskRecord(taskId);
    if (!stored) {
      json(404, { error: "Task not found" });
      return true;
    }
    try {
      const client = createArcPublicClient();
      const onChain = await readOnChainTask(taskId, client);
      const round = url.searchParams.has("round")
        ? Number(url.searchParams.get("round"))
        : onChain.round;
      const bids = await listBidsForTask(taskId, round);
      const { scoreBids } = await import("../agent/score-bids.js");
      const selection = await scoreBids(bids, onChain.maxBudget);
      json(200, selection);
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Bid scoring failed" });
    }
    return true;
  }

  return false;
}
