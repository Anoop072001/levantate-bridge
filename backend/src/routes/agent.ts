import type { IncomingMessage, ServerResponse } from "node:http";
import { pendingHandle } from "../relayer/submit.js";
import {
  deriveTaskParams,
  runAgentCycle,
  runWinnerSelectionCycle,
  scoreBids,
} from "../agent/runner.js";
import {
  appendAgentChatMessage,
  createAgentChat,
  deleteAgentChat,
  getAgentChat,
  listAgentChatMessages,
  listAgentChats,
  titleFromFirstMessage,
  updateAgentChatStatus,
  updateAgentChatTitle,
} from "../agent/chat-store.js";
import { isChatAvailable, runChatTurn, type ChatMessage } from "../agent/chat.js";
import type { AgentStep } from "../agent/tools.js";
import { postTask } from "../agent/operations.js";
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

  if (req.method === "GET" && url.pathname === "/api/agent/chat") {
    json(200, { available: isChatAvailable() });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/agent/chats") {
    try {
      json(200, { chats: await listAgentChats() });
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Failed to list chats" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/chats") {
    const input = body as { title?: string };
    try {
      const chat = await createAgentChat(input.title?.trim() || "New chat");
      json(201, { chat });
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Failed to create chat" });
    }
    return true;
  }

  const chatMatch = url.pathname.match(/^\/api\/agent\/chats\/([0-9a-f-]{36})$/);
  if (chatMatch) {
    const chatId = chatMatch[1]!;
    if (req.method === "GET") {
      try {
        const chat = await getAgentChat(chatId);
        if (!chat) {
          json(404, { error: "Chat not found" });
          return true;
        }
        const messages = await listAgentChatMessages(chatId);
        json(200, { chat, messages });
      } catch (err) {
        json(500, { error: err instanceof Error ? err.message : "Failed to load chat" });
      }
      return true;
    }
    if (req.method === "DELETE") {
      try {
        await deleteAgentChat(chatId);
        json(204, {});
      } catch (err) {
        json(500, { error: err instanceof Error ? err.message : "Failed to delete chat" });
      }
      return true;
    }
  }

  const chatMessageMatch = url.pathname.match(/^\/api\/agent\/chats\/([0-9a-f-]{36})\/messages$/);
  if (req.method === "POST" && chatMessageMatch) {
    const chatId = chatMessageMatch[1]!;
    const input = body as { content?: string };
    const content = input.content?.trim();
    if (!content) {
      json(400, { error: "content required" });
      return true;
    }
    if (!isChatAvailable()) {
      json(503, { error: "Agent chat requires OPENAI_API_KEY in .env.local" });
      return true;
    }
    try {
      const chat = await getAgentChat(chatId);
      if (!chat) {
        json(404, { error: "Chat not found" });
        return true;
      }

      const resumingFromIdle = chat.status === "idle";
      await updateAgentChatStatus(chatId, "active");

      const prior = await listAgentChatMessages(chatId);
      const userMessage = await appendAgentChatMessage({
        chatId,
        role: "user",
        content,
      });

      if (chat.title === "New chat" && prior.length === 0) {
        await updateAgentChatTitle(chatId, titleFromFirstMessage(content));
      }

      const history: ChatMessage[] = [
        ...prior.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];
      const turn = await runChatTurn(history, { resumingFromIdle });

      const steps: AgentStep[] = turn.steps;
      const assistantMessage = await appendAgentChatMessage({
        chatId,
        role: "assistant",
        content: turn.reply,
        steps,
      });

      const postedTask = steps.some((s) => s.tool === "post_task" && s.ok);
      if (postedTask) {
        await updateAgentChatStatus(chatId, "idle");
      }

      const updatedChat = (await getAgentChat(chatId))!;

      json(200, {
        userMessage,
        assistantMessage,
        reply: turn.reply,
        steps,
        chatStatus: updatedChat.status,
      });
    } catch (err) {
      json(502, { error: err instanceof Error ? err.message : "Agent chat failed" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/chat") {
    const input = body as { messages?: ChatMessage[] };
    const history = (input.messages ?? []).filter(
      (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
    if (history.length === 0) {
      json(400, { error: "messages required" });
      return true;
    }
    if (!isChatAvailable()) {
      json(503, { error: "Agent chat requires OPENAI_API_KEY in .env.local" });
      return true;
    }
    try {
      json(200, await runChatTurn(history));
    } catch (err) {
      json(502, { error: err instanceof Error ? err.message : "Agent chat failed" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/tasks") {
    const input = body as {
      description?: string;
      bidDeadlineSeconds?: number;
      submissionWindowSeconds?: number;
    };
    if (!input.description) {
      json(400, { error: "description required" });
      return true;
    }
    const result = await postTask({
      description: input.description,
      bidDeadlineSeconds: input.bidDeadlineSeconds ?? 3600,
      submissionWindowSeconds: input.submissionWindowSeconds,
    });
    if (!result.ok) {
      json(result.status, { error: result.error });
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
    const stored = await getTask(taskId);
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
let winnerTimer: ReturnType<typeof setInterval> | undefined;

export function startWinnerSelectionLoop(intervalMs = 60_000): void {
  if (winnerTimer) return;
  winnerTimer = setInterval(() => {
    void runWinnerSelectionCycle().catch((err) => {
      console.warn("[agent] winner selection error:", err instanceof Error ? err.message : err);
    });
  }, intervalMs);
  console.log(`Winner selection loop enabled (every ${intervalMs / 1000}s)`);
}

export function startAgentLoop(intervalMs = 30_000): void {
  if (agentTimer) return;
  agentTimer = setInterval(() => {
    void runAgentCycle().catch((err) => {
      console.warn("[agent] cycle error:", err instanceof Error ? err.message : err);
    });
  }, intervalMs);
  console.log(`Background agent loop enabled (every ${intervalMs / 1000}s) — set AGENT_AUTO_LOOP=true`);
}

export function stopAgentLoop(): void {
  if (agentTimer) {
    clearInterval(agentTimer);
    agentTimer = undefined;
  }
  if (winnerTimer) {
    clearInterval(winnerTimer);
    winnerTimer = undefined;
  }
}
