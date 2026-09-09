import type { AgentStep } from "./tools.js";
import { getSupabase } from "../db/supabase.js";

export type AgentChatStatus = "active" | "idle";

export interface AgentChatRecord {
  id: string;
  title: string;
  status: AgentChatStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentChatMessageRecord {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  steps: AgentStep[] | null;
  createdAt: string;
}

interface ChatRow {
  id: string;
  title: string;
  status?: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  steps: AgentStep[] | null;
  created_at: string;
}

function mapChat(row: ChatRow): AgentChatRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status === "idle" ? "idle" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): AgentChatMessageRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role as "user" | "assistant",
    content: row.content,
    steps: row.steps,
    createdAt: row.created_at,
  };
}

function fail(op: string, error: { message: string }): never {
  throw new Error(`${op}: ${error.message}`);
}

export async function listAgentChats(): Promise<AgentChatRecord[]> {
  const { data, error } = await getSupabase()
    .from("agent_chats")
    .select("id, title, status, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) fail("listAgentChats", error);
  return (data as ChatRow[]).map(mapChat);
}

export async function createAgentChat(title = "New chat"): Promise<AgentChatRecord> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("agent_chats")
    .insert({ title, updated_at: now })
    .select("id, title, status, created_at, updated_at")
    .single();
  if (error) fail("createAgentChat", error);
  return mapChat(data as ChatRow);
}

export async function getAgentChat(chatId: string): Promise<AgentChatRecord | undefined> {
  const { data, error } = await getSupabase()
    .from("agent_chats")
    .select("id, title, status, created_at, updated_at")
    .eq("id", chatId)
    .maybeSingle();
  if (error) fail("getAgentChat", error);
  return data ? mapChat(data as ChatRow) : undefined;
}

export async function deleteAgentChat(chatId: string): Promise<void> {
  const { error } = await getSupabase().from("agent_chats").delete().eq("id", chatId);
  if (error) fail("deleteAgentChat", error);
}

export async function listAgentChatMessages(chatId: string): Promise<AgentChatMessageRecord[]> {
  const { data, error } = await getSupabase()
    .from("agent_chat_messages")
    .select("id, chat_id, role, content, steps, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) fail("listAgentChatMessages", error);
  return (data as MessageRow[]).map(mapMessage);
}

export async function appendAgentChatMessage(input: {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[] | null;
}): Promise<AgentChatMessageRecord> {
  const { data, error } = await getSupabase()
    .from("agent_chat_messages")
    .insert({
      chat_id: input.chatId,
      role: input.role,
      content: input.content,
      steps: input.steps ?? null,
    })
    .select("id, chat_id, role, content, steps, created_at")
    .single();
  if (error) fail("appendAgentChatMessage", error);

  await getSupabase()
    .from("agent_chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.chatId);

  return mapMessage(data as MessageRow);
}

export async function updateAgentChatTitle(chatId: string, title: string): Promise<void> {
  const { error } = await getSupabase()
    .from("agent_chats")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", chatId);
  if (error) fail("updateAgentChatTitle", error);
}

export async function updateAgentChatStatus(
  chatId: string,
  status: AgentChatStatus,
): Promise<void> {
  const { error } = await getSupabase()
    .from("agent_chats")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", chatId);
  if (error) fail("updateAgentChatStatus", error);
}

export function titleFromFirstMessage(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New chat";
  return trimmed.length <= 56 ? trimmed : `${trimmed.slice(0, 53)}…`;
}
