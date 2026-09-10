import { backendUrl } from "./config";
import type { RelayedTransaction } from "./types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStepDownload {
  label: string;
  url: string;
}

export interface AgentFundingHint {
  agent_address: string;
  balance_usdc: number;
  required_usdc: number;
  faucet_url: string;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  transactions: RelayedTransaction[];
  downloads?: AgentStepDownload[];
  funding?: AgentFundingHint;
}

export type AgentChatStatus = "active" | "idle";

export interface AgentChatSummary {
  id: string;
  title: string;
  status: AgentChatStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatTurn {
  id: string;
  message: ChatMessage;
  steps?: AgentStep[];
}

export interface AgentChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  steps: AgentStep[] | null;
  createdAt: string;
}

async function parseJson<T>(res: Response): Promise<T & { error?: string }> {
  return res.json() as Promise<T & { error?: string }>;
}

export async function fetchChatAvailability(): Promise<boolean> {
  const res = await fetch(`${backendUrl}/api/agent/chat`, { cache: "no-store" });
  const data = await parseJson<{ available?: boolean }>(res);
  return Boolean(data.available);
}

export async function fetchAgentChats(): Promise<AgentChatSummary[]> {
  const res = await fetch(`${backendUrl}/api/agent/chats`, { cache: "no-store" });
  const data = await parseJson<{ chats: AgentChatSummary[] }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to load chats");
  return data.chats;
}

export async function createAgentChat(title?: string): Promise<AgentChatSummary> {
  const res = await fetch(`${backendUrl}/api/agent/chats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  const data = await parseJson<{ chat: AgentChatSummary }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to create chat");
  return data.chat;
}

export async function fetchAgentChat(chatId: string): Promise<{
  chat: AgentChatSummary;
  messages: AgentChatMessage[];
}> {
  const res = await fetch(`${backendUrl}/api/agent/chats/${chatId}`, { cache: "no-store" });
  const data = await parseJson<{ chat: AgentChatSummary; messages: AgentChatMessage[] }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to load chat");
  return data;
}

export async function deleteAgentChat(chatId: string): Promise<void> {
  const res = await fetch(`${backendUrl}/api/agent/chats/${chatId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await parseJson<{ error?: string }>(res);
    throw new Error(data.error ?? "Failed to delete chat");
  }
}

export function messagesToTurns(messages: AgentChatMessage[]): StoredChatTurn[] {
  return messages.map((m) => ({
    id: m.id,
    message: { role: m.role, content: m.content },
    steps: m.steps ?? undefined,
  }));
}

export async function sendChatMessage(
  chatId: string,
  content: string,
): Promise<{
  reply: string;
  steps: AgentStep[];
  userMessage: AgentChatMessage;
  assistantMessage: AgentChatMessage;
  chatStatus: AgentChatStatus;
}> {
  const res = await fetch(`${backendUrl}/api/agent/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await parseJson<{
    reply: string;
    steps: AgentStep[];
    userMessage: AgentChatMessage;
    assistantMessage: AgentChatMessage;
    chatStatus: AgentChatStatus;
  }>(res);
  if (!res.ok) throw new Error(data.error ?? "Agent chat failed");
  return data;
}
