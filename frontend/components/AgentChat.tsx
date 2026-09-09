"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check, Loader2, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PendingTransaction } from "@/components/PendingTransaction";
import { fetchChatAvailability, sendChatTurn, type AgentStep, type ChatMessage } from "@/lib/agent-chat";
import { cn } from "@/lib/cn";

interface Turn {
  message: ChatMessage;
  steps?: AgentStep[];
}

const SUGGESTIONS = [
  "What's the state of every task right now?",
  "Post a task to collect and summarize neighborhood complaints, bidding open 10 minutes",
  "Score the bids on task 4 and tell me who should win",
];

export function AgentChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchChatAvailability()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const nextTurns: Turn[] = [...turns, { message: { role: "user", content: trimmed } }];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const result = await sendChatTurn(nextTurns.map((t) => t.message));
      setTurns([
        ...nextTurns,
        { message: { role: "assistant", content: result.reply }, steps: result.steps },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent chat failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-73px)] flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {turns.length === 0 ? (
          <div className="space-y-6">
            <div className="space-y-3">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Agent console</h1>
              <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
                Tell the agent what you want and it posts tasks, escrows USDC, picks winners from
                live subgraph history, and releases payment. Every write is a real Arc transaction.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {turns.map((turn, i) => (
              <div key={i} className="space-y-3">
                {turn.message.role === "user" ? (
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-zinc-900 px-5 py-3 text-sm leading-relaxed text-white">
                      {turn.message.content}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {turn.steps?.map((step, j) => <StepCard key={j} step={step} />)}
                    <p className="max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                      {turn.message.content}
                    </p>
                  </div>
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

        {error && <p className="mt-6 text-sm text-red-700">{error}</p>}

        {available === false && (
          <p className="mt-6 text-sm text-red-700">
            The agent needs <code>OPENAI_API_KEY</code> in <code>.env.local</code> to run.
          </p>
        )}

        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background/85 backdrop-blur-md">
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
            placeholder="Post a task, check bids, release payment…"
            className="max-h-40 min-h-[48px] flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-transform active:scale-95 disabled:opacity-30"
            aria-label="Send"
          >
            <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </form>
      </div>
    </div>
  );
}

function StepCard({ step }: { step: AgentStep }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="space-y-2"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          {step.ok ? (
            <Check className="h-3 w-3 text-emerald-700" />
          ) : (
            <X className="h-3 w-3 text-red-700" />
          )}
          <Wrench className="h-3 w-3" />
          <code className={cn("font-medium", step.ok ? "text-foreground" : "text-red-700")}>
            {step.tool}
          </code>
          <span>{step.summary}</span>
        </div>
        {step.transactions.map((tx) => (
          <PendingTransaction key={tx.transactionId} initial={tx} className="max-w-md" />
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
