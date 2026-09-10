"use client";

import { Loader2, ArrowUp, Copy, Download, MessageSquarePlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PendingTransaction } from "@/components/PendingTransaction";
import {
  ToolCallsSection,
  type ToolCallEntry,
} from "@/components/ui/tool-calls-section";
import { toolCategoryFor } from "@/components/ui/tool-calls-section-utils/tool-icons";
import {
  createAgentChat,
  deleteAgentChat,
  fetchAgentChat,
  fetchAgentChats,
  fetchChatAvailability,
  messagesToTurns,
  sendChatMessage,
  type AgentChatSummary,
  type AgentFundingHint,
  type AgentStep,
  type StoredChatTurn,
} from "@/lib/agent-chat";
import { cn, insetButtonDarkClass } from "@/lib/cn";

const SUGGESTIONS = [
  "What's the state of every task right now?",
  "Post a task to collect and summarize neighborhood complaints, bidding open 10 minutes",
  "What was the most common complaint in task 8's proof?",
];

function needsFundingHint(funding: AgentFundingHint): boolean {
  return funding.required_usdc > 0 && funding.balance_usdc < funding.required_usdc;
}

function stepsToToolCalls(steps: AgentStep[]): ToolCallEntry[] {
  return steps.map((step) => ({
    tool_name: step.tool,
    tool_category: toolCategoryFor(step.tool),
    message: step.summary,
    inputs: Object.keys(step.args).length > 0 ? step.args : undefined,
    show_category: true,
  }));
}

export function AgentChat() {
  const [chats, setChats] = useState<AgentChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<StoredChatTurn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [chatStatus, setChatStatus] = useState<"active" | "idle">("active");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadChat = useCallback(async (chatId: string) => {
    const { chat, messages } = await fetchAgentChat(chatId);
    setActiveChatId(chat.id);
    setChatStatus(chat.status ?? "active");
    setTurns(messagesToTurns(messages));
    setChats((prev) => {
      const rest = prev.filter((c) => c.id !== chat.id);
      return [chat, ...rest];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [chatList, ok] = await Promise.all([fetchAgentChats(), fetchChatAvailability()]);
        if (cancelled) return;
        setAvailable(ok);
        if (chatList.length === 0) {
          const chat = await createAgentChat();
          if (cancelled) return;
          setChats([chat]);
          setActiveChatId(chat.id);
          setTurns([]);
        } else {
          setChats(chatList);
          await loadChat(chatList[0]!.id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load agent chats");
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadChat]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  async function handleNewChat() {
    setError(null);
    try {
      const chat = await createAgentChat();
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      setTurns([]);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create chat");
    }
  }

  async function handleSelectChat(chatId: string) {
    if (chatId === activeChatId || busy) return;
    setError(null);
    try {
      await loadChat(chatId);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat");
    }
  }

  async function handleDeleteChat(chatId: string) {
    if (busy) return;
    setError(null);
    try {
      await deleteAgentChat(chatId);
      const remaining = chats.filter((c) => c.id !== chatId);
      if (remaining.length === 0) {
        const chat = await createAgentChat();
        setChats([chat]);
        setActiveChatId(chat.id);
        setTurns([]);
      } else if (chatId === activeChatId) {
        setChats(remaining);
        await loadChat(remaining[0]!.id);
      } else {
        setChats(remaining);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete chat");
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !activeChatId) return;

    const optimisticId = `optimistic-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      { id: optimisticId, message: { role: "user", content: trimmed } },
    ]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const result = await sendChatMessage(activeChatId, trimmed);
      setTurns((prev) => {
        const withoutOptimistic = prev.filter((t) => t.id !== optimisticId);
        return [
          ...withoutOptimistic,
          {
            id: result.userMessage.id,
            message: { role: "user", content: trimmed },
          },
          {
            id: result.assistantMessage.id,
            message: { role: "assistant", content: result.reply },
            steps: result.steps,
          },
        ];
      });
      setChatStatus(result.chatStatus);
      const refreshed = await fetchAgentChats();
      setChats(refreshed);
    } catch (err) {
      setTurns((prev) => prev.filter((t) => t.id !== optimisticId));
      setInput(trimmed);
      setError(err instanceof Error ? err.message : "Agent chat failed");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) {
    return (
      <div className="flex h-[calc(100vh-73px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading chats…</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-73px)] overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/30">
        <div className="shrink-0 p-3">
          <button
            type="button"
            onClick={() => void handleNewChat()}
            disabled={busy}
            className={`${insetButtonDarkClass} w-full justify-center text-sm`}
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={cn(
                "mb-1 flex items-center gap-1 rounded-lg",
                chat.id === activeChatId ? "bg-background shadow-sm" : "hover:bg-background/60",
              )}
            >
              <button
                type="button"
                onClick={() => void handleSelectChat(chat.id)}
                disabled={busy}
                className="min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {chat.title}
              </button>
              <button
                type="button"
                aria-label="Delete chat"
                title="Delete chat"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteChat(chat.id);
                }}
                className="mr-1 shrink-0 cursor-pointer rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-10">
            {turns.length === 0 ? (
              <div className="space-y-6">
                <div className="space-y-3">
                  <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Agent console</h1>
                  <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
                    Multiple chats are saved in the database. External AI clients can connect via MCP
                    (run <code className="text-sm">npm run mcp --prefix backend</code>).
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      disabled={busy}
                      className="cursor-pointer rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <h1 className="text-2xl font-bold tracking-tight">
                  {chats.find((c) => c.id === activeChatId)?.title ?? "Agent console"}
                </h1>
                {turns.map((turn) => (
                  <div key={turn.id} className="space-y-3">
                    {turn.message.role === "user" ? (
                      <div className="flex justify-end">
                        <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-zinc-900 px-5 py-3 text-sm leading-relaxed text-white">
                          {turn.message.content}
                        </p>
                      </div>
                    ) : (
                      <AssistantTurn turn={turn} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {busy && (
              <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Working — on-chain calls take a few seconds each.
              </p>
            )}

            {chatStatus === "idle" && !busy && (
              <p className="mt-6 rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
                Agent is idle — task posted. Workers bid on the task board; send a message anytime for
                a status update or to assign a winner, review proof, or release payment.
              </p>
            )}

            {error && <p className="mt-6 text-sm text-red-700">{error}</p>}

            {available === false && (
              <p className="mt-6 text-sm text-red-700">
                The agent needs <code>OPENAI_API_KEY</code> in <code>.env.local</code> to run.
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background/85 backdrop-blur-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-4"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Post a task, check bids, read submitted proof…"
              className="max-h-40 min-h-12 flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-300"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || !activeChatId}
              className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-zinc-900 text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AssistantTurn({ turn }: { turn: StoredChatTurn }) {
  const steps = turn.steps ?? [];

  return (
    <div className="space-y-3">
      {steps.length > 0 && (
        <>
          <ToolCallsSection toolCalls={stepsToToolCalls(steps)} defaultExpanded />
          <StepExtras steps={steps} />
        </>
      )}
      <p className="max-w-[90%] whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {turn.message.content}
      </p>
    </div>
  );
}

function StepExtras({ steps }: { steps: AgentStep[] }) {
  return (
    <>
      {steps.map((step, i) => (
        <div key={`${step.tool}-${i}`} className="space-y-2">
          {step.funding && needsFundingHint(step.funding) && (
            <FundingCard funding={step.funding} />
          )}
          {step.downloads?.map((file) => (
            <a
              key={file.url}
              href={file.url}
              download
              className={`${insetButtonDarkClass} max-w-md text-sm`}
            >
              <Download className="h-4 w-4" />
              Download {file.label}
            </a>
          ))}
          {step.transactions.map((tx) => (
            <PendingTransaction key={tx.transactionId} initial={tx} className="max-w-md" />
          ))}
        </div>
      ))}
    </>
  );
}

function FundingCard({ funding }: { funding: AgentFundingHint }) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(funding.agent_address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="max-w-md space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">Fund the agent wallet on Arc testnet</p>
      <p className="text-xs leading-relaxed">
        Balance: {funding.balance_usdc.toFixed(2)} USDC · Need:{" "}
        {funding.required_usdc.toFixed(2)} USDC
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all text-xs">{funding.agent_address}</code>
        <button
          type="button"
          onClick={() => void copyAddress()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium hover:bg-amber-100"
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>
      <a
        href={funding.faucet_url}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs font-medium underline underline-offset-2"
      >
        Open Circle faucet (select Arc Testnet)
      </a>
    </div>
  );
}
