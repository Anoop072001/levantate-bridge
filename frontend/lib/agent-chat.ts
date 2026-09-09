import { backendUrl } from "./config";
import type { RelayedTransaction } from "./types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  transactions: RelayedTransaction[];
}

export interface ChatTurn {
  reply: string;
  steps: AgentStep[];
}

export async function sendChatTurn(messages: ChatMessage[]): Promise<ChatTurn> {
  const res = await fetch(`${backendUrl}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = (await res.json()) as ChatTurn & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Agent chat failed");
  return data;
}

export async function fetchChatAvailability(): Promise<boolean> {
  const res = await fetch(`${backendUrl}/api/agent/chat`, { cache: "no-store" });
  const data = (await res.json()) as { available?: boolean };
  return Boolean(data.available);
}
