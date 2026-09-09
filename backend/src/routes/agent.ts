import type { IncomingMessage, ServerResponse } from "node:http";
import { pendingHandle } from "../relayer/submit.js";
import { agentPostTask, deriveTaskParams, runAgentCycle, scoreBids } from "../agent/runner.js";
import { getTask, listBidsForTask } from "../store.js";
import { createArcPublicClient } from "../chain/escrow.js";
import { readOnChainTask } from "../chain/task-state.js";

export async function handleAgentRoute(
  req: IncomingMessage,
  _res: ServerResponse,
  url: URL,
  body: unknown,
  json: (status: number, payload: unknown) => void,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/agent/budget") {
    try {
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
    try {
      const result = await runAgentCycle();
      json(200, result);
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Agent cycle failed" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/tasks") {
    const input = body as { description?: string; bidDeadlineSeconds?: number };
    if (!input.description) {
      json(400, { error: "description required" });
      return true;
    }
    try {
      const result = await agentPostTask(input.description, input.bidDeadlineSeconds ?? 3600);
      json(202, {
        taskId: result.taskId,
        reasoning: result.params.reasoning,
        maxBudget: result.params.maxBudget.toString(),
        submissionWindow: result.params.submissionWindow.toString(),
        transactions: result.transactions.map(pendingHandle),
      });
    } catch (err) {
      json(502, { error: err instanceof Error ? err.message : "Agent post task failed" });
    }
    return true;
  }

  const scoreMatch = url.pathname.match(/^\/api\/agent\/tasks\/(\d+)\/score-bids$/);
  if (req.method === "GET" && scoreMatch) {
    const taskId = Number(scoreMatch[1]);
    const stored = getTask(taskId);
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
      const bids = listBidsForTask(taskId, round);
      const selection = await scoreBids(bids, onChain.maxBudget);
      json(200, selection);
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Bid scoring failed" });
    }
    return true;
  }

  return false;
}

let agentTimer: ReturnType<typeof setInterval> | undefined;

export function startAgentLoop(intervalMs = 30_000): void {
  if (agentTimer) return;
  agentTimer = setInterval(() => {
    void runAgentCycle().catch((err) => {
      console.error("[agent] cycle error:", err instanceof Error ? err.message : err);
    });
  }, intervalMs);
  console.log(`Agent loop started (every ${intervalMs / 1000}s)`);
}

export function stopAgentLoop(): void {
  if (agentTimer) {
    clearInterval(agentTimer);
    agentTimer = undefined;
  }
}
