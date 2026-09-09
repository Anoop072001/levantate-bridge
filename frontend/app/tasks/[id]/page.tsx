"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Clock, Coins, MapPin } from "lucide-react";
import { BidSheet } from "@/components/BidSheet";
import { Countdown } from "@/components/Countdown";
import { LinkWalletButton } from "@/components/LinkWalletButton";
import { PageFrame } from "@/components/PageFrame";
import { PendingTransaction } from "@/components/PendingTransaction";
import { fetchBids, fetchTask, fetchWorkerBalance, submitProof, usdcMicroToDisplay } from "@/lib/api";
import { insetButtonDarkClass } from "@/lib/cn";
import { shortAddress, taskHeadline } from "@/lib/task-display";
import { secondsRemaining } from "@/lib/time";
import { useWorkerSession } from "@/lib/use-worker-session";
import type { Bid, RelayedTransaction, Task } from "@/lib/types";

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = Number(params.id);

  const [task, setTask] = useState<Task | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [proofContent, setProofContent] = useState("");
  const [proofLink, setProofLink] = useState("");
  const [pendingTx, setPendingTx] = useState<RelayedTransaction | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bidOpenSheet, setBidOpenSheet] = useState(false);

  const { session, ready } = useWorkerSession();

  const reload = useCallback(() => {
    Promise.all([fetchTask(taskId), fetchBids(taskId)])
      .then(([nextTask, nextBids]) => {
        setTask(nextTask);
        setBids(nextBids.filter((b) => b.round === nextTask.round));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [taskId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!session?.walletAddress) return;
    fetchWorkerBalance(session.walletAddress)
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [session?.walletAddress, pendingTx?.status]);

  const isAssignedWorker =
    session &&
    task &&
    task.assignedWorker.toLowerCase() === session.walletAddress.toLowerCase();

  const bidOpen =
    task && (task.state === 0 || task.state === 1) && secondsRemaining(task.bidDeadline) > 0;

  const myBids =
    session && task
      ? bids.filter((b) => b.workerAddress.toLowerCase() === session.walletAddress.toLowerCase())
      : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.nullifierHash || !task) return;
    setActionError(null);
    try {
      const tx = await submitProof(taskId, session.nullifierHash, proofContent, proofLink || undefined);
      setPendingTx(tx);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Submit failed");
    }
  }

  if (error) {
    return (
      <PageFrame>
        <p className="text-red-700">{error}</p>
        <Link href="/tasks" className="mt-4 inline-block text-sm underline underline-offset-2">
          ← Tasks
        </Link>
      </PageFrame>
    );
  }

  if (!task) {
    return (
      <PageFrame>
        <p className="text-muted-foreground">Loading…</p>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <p className="mb-8">
        <Link href="/tasks" className="text-sm text-muted-foreground hover:text-foreground">
          ← Tasks
        </Link>
      </p>

      <div className="mb-10 space-y-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground">
          Task #{task.id} · Round {task.round}
        </span>
        <h1 className="max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight sm:text-5xl">
          {taskHeadline(task.description)}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{task.description}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> Arc testnet
          </span>
          <span>•</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {task.stateLabel}
          </span>
          <span>•</span>
          <span className="inline-flex items-center gap-1">
            <Coins className="h-3.5 w-3.5" /> {usdcMicroToDisplay(task.maxBudget)} USDC
          </span>
        </div>
        {task.state === 0 || task.state === 1 ? (
          <Countdown deadlineUnix={task.bidDeadline} label="Bid deadline" className="block text-sm" />
        ) : null}
        {task.state === 2 || task.state === 3 ? (
          <Countdown deadlineUnix={task.submissionDeadline} label="Submission deadline" className="block text-sm" />
        ) : null}
      </div>

      {ready && session && (
        <p className="mb-2 text-sm text-muted-foreground">
          Your worker wallet: <code className="text-foreground">{shortAddress(session.walletAddress)}</code>
          {balance !== null && (
            <>
              {" "}
              · {usdcMicroToDisplay(balance)} USDC —{" "}
              <Link href="/wallet" className="underline underline-offset-2">
                wallet
              </Link>
            </>
          )}
        </p>
      )}

      {bids.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold tracking-tight">Bids this round ({bids.length})</h2>
          <div className="mt-2">
            {bids.map((bid, i) => {
              const mine =
                session && bid.workerAddress.toLowerCase() === session.walletAddress.toLowerCase();
              return (
                <div
                  key={bid.id}
                  className={`flex items-center justify-between py-4 text-sm ${i < bids.length - 1 ? "border-b border-border" : ""}`}
                >
                  <span>
                    {usdcMicroToDisplay(bid.amount)} USDC —{" "}
                    <code>{shortAddress(bid.workerAddress)}</code>
                    {mine ? " (you)" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pendingTx && !bidOpenSheet && (
        <div className="mt-6">
          <PendingTransaction
            initial={pendingTx}
            onSettled={() => {
              reload();
              if (session?.walletAddress) {
                fetchWorkerBalance(session.walletAddress).then(setBalance).catch(() => undefined);
              }
            }}
          />
        </div>
      )}

      {actionError && <p className="mt-4 text-sm text-red-700">{actionError}</p>}

      {bidOpen && myBids.length > 0 && (
        <p className="mt-6 text-sm text-foreground">
          You already bid on this task. The agent picks a winner after the bid deadline closes.
        </p>
      )}

      {bidOpen && (
        <div className="mt-8">
          <button type="button" onClick={() => setBidOpenSheet(true)} className={`${insetButtonDarkClass} h-14 px-8 text-base`}>
            {myBids.length > 0 ? "Place another bid" : "Place a bid"}
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      )}

      {task.state === 2 && isAssignedWorker && !session?.nullifierHash && (
        <div className="mt-8 space-y-3">
          <p>Reconnect this wallet to submit work.</p>
          <LinkWalletButton label="Sign to reconnect" />
        </div>
      )}

      {task.state === 2 && isAssignedWorker && session?.nullifierHash && (
        <section className="mt-10 max-w-xl space-y-4 border-t border-border pt-8">
          <h2 className="text-2xl font-bold tracking-tight">Submit proof</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm">
              Summary / proof text
              <textarea
                value={proofContent}
                onChange={(e) => setProofContent(e.target.value)}
                required
                rows={5}
                className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
              />
            </label>
            <label className="block text-sm">
              Optional link
              <input
                type="url"
                value={proofLink}
                onChange={(e) => setProofLink(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
              />
            </label>
            <button type="submit" className={insetButtonDarkClass}>
              Submit work
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </form>
        </section>
      )}

      {ready && task.state === 2 && session && !isAssignedWorker && (
        <p className="mt-8 text-sm text-muted-foreground">You are not the assigned worker for this task.</p>
      )}

      {task.state === 3 && isAssignedWorker && (
        <p className="mt-8 text-sm">Work submitted — waiting for agent review. You can resubmit if the agent rejects.</p>
      )}

      {task.state === 4 && isAssignedWorker && (
        <p className="mt-8 text-sm text-emerald-700">Paid — check your wallet balance above.</p>
      )}

      {ready && task.state === 0 && task.round > 0 && session && (
        <p className="mt-8 text-sm text-muted-foreground">
          This task was reclaimed after a missed deadline. Workers who defaulted may be barred from re-bidding.
        </p>
      )}

      <BidSheet
        task={task}
        open={bidOpenSheet}
        onClose={() => setBidOpenSheet(false)}
        onSettled={reload}
        onSubmitted={setPendingTx}
      />
    </PageFrame>
  );
}
