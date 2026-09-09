"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Countdown } from "@/components/Countdown";
import { PendingTransaction } from "@/components/PendingTransaction";
import {
  fetchBids,
  fetchTask,
  fetchWorkerBalance,
  placeBid,
  submitProof,
  usdcDisplayToMicro,
  usdcMicroToDisplay,
} from "@/lib/api";
import { useWorkerSession } from "@/lib/use-worker-session";
import type { Bid, RelayedTransaction, Task } from "@/lib/types";
import { secondsRemaining } from "@/lib/time";

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = Number(params.id);

  const [task, setTask] = useState<Task | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [proofContent, setProofContent] = useState("");
  const [proofLink, setProofLink] = useState("");
  const [pendingTx, setPendingTx] = useState<RelayedTransaction | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const verifyHref = `/verify?signal=task-${taskId}-round-${task?.round ?? 0}&return=/tasks/${taskId}`;

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

  async function handleBid(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !task) return;
    setActionError(null);
    try {
      const amount = usdcDisplayToMicro(bidAmount);
      if (amount <= 0 || amount > Number(task.maxBudget)) {
        setActionError(`Bid must be between 0 and ${usdcMicroToDisplay(task.maxBudget)} USDC`);
        return;
      }
      const amountStr = amount.toString();
      if (myBids.some((b) => b.amount === amountStr)) {
        setActionError("You already placed a bid for this amount on this task");
        return;
      }
      const tx = await placeBid(taskId, session.nullifierHash, amount);
      setPendingTx(tx);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Bid failed");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !task) return;
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
      <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
        <p style={{ color: "crimson" }}>{error}</p>
        <Link href="/tasks">← Tasks</Link>
      </main>
    );
  }

  if (!task) {
    return (
      <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <p>
        <Link href="/tasks">← Tasks</Link>
      </p>

      <h1>Task #{task.id}</h1>
      <p>{task.description}</p>
      <p>
        Budget: {usdcMicroToDisplay(task.maxBudget)} USDC · State: <strong>{task.stateLabel}</strong>{" "}
        · Round {task.round}
      </p>

      {task.state === 0 || task.state === 1 ? (
        <Countdown deadlineUnix={task.bidDeadline} label="Bid deadline" />
      ) : null}

      {task.state === 2 || task.state === 3 ? (
        <Countdown deadlineUnix={task.submissionDeadline} label="Submission deadline" />
      ) : null}

      {ready && session && (
        <p style={{ fontSize: "0.9rem", color: "#666" }}>
          Your worker wallet: <code>{session.walletAddress}</code>
        </p>
      )}

      {session && balance !== null && (
        <p style={{ fontSize: "0.9rem" }}>
          Your wallet balance: {usdcMicroToDisplay(balance)} USDC
        </p>
      )}

      {bids.length > 0 && (
        <section style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem" }}>Bids this round ({bids.length})</h2>
          <ul style={{ paddingLeft: "1.25rem", fontSize: "0.9rem" }}>
            {bids.map((bid) => {
              const mine =
                session &&
                bid.workerAddress.toLowerCase() === session.walletAddress.toLowerCase();
              return (
                <li key={bid.id} style={{ marginBottom: "0.35rem" }}>
                  {usdcMicroToDisplay(bid.amount)} USDC —{" "}
                  <code>{bid.workerAddress.slice(0, 10)}…</code>
                  {mine ? " (you)" : ""}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pendingTx && (
        <PendingTransaction
          initial={pendingTx}
          onSettled={() => {
            reload();
            if (session?.walletAddress) {
              fetchWorkerBalance(session.walletAddress).then(setBalance).catch(() => undefined);
            }
          }}
        />
      )}

      {actionError && <p style={{ color: "crimson" }}>{actionError}</p>}

      {bidOpen && myBids.length > 0 && (
        <p style={{ marginTop: "1rem", color: "#333" }}>
          You already bid on this task. The agent picks a winner after the bid deadline closes.
        </p>
      )}

      {bidOpen && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>{myBids.length > 0 ? "Place another bid (different amount)" : "Place a bid"}</h2>
          {!ready ? null : !session ? (
            <p>
              <Link href={verifyHref}>Verify with World ID</Link> to bid on this task.
            </p>
          ) : (
            <form onSubmit={handleBid}>
              <label>
                Amount (USDC, max {usdcMicroToDisplay(task.maxBudget)})
                <br />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={usdcMicroToDisplay(task.maxBudget)}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  required
                  style={{ width: "100%", maxWidth: 240, marginTop: 4 }}
                />
              </label>
              <br />
              <button type="submit" style={{ marginTop: "0.75rem" }}>
                Submit bid
              </button>
            </form>
          )}
        </section>
      )}

      {task.state === 2 && isAssignedWorker && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Submit proof</h2>
          <form onSubmit={handleSubmit}>
            <label>
              Summary / proof text
              <br />
              <textarea
                value={proofContent}
                onChange={(e) => setProofContent(e.target.value)}
                required
                rows={5}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <br />
            <label>
              Optional link
              <br />
              <input
                type="url"
                value={proofLink}
                onChange={(e) => setProofLink(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <br />
            <button type="submit" style={{ marginTop: "0.75rem" }}>
              Submit work
            </button>
          </form>
        </section>
      )}

      {ready && task.state === 2 && session && !isAssignedWorker && (
        <p style={{ marginTop: "1.5rem", color: "#666" }}>
          You are not the assigned worker for this task.
        </p>
      )}

      {task.state === 3 && isAssignedWorker && (
        <p style={{ marginTop: "1.5rem" }}>
          Work submitted — waiting for agent review. You can resubmit if the agent rejects.
        </p>
      )}

      {task.state === 4 && isAssignedWorker && (
        <p style={{ marginTop: "1.5rem", color: "green" }}>
          Paid — check your wallet balance above.
        </p>
      )}

      {ready && task.state === 0 && task.round > 0 && session && (
        <p style={{ marginTop: "1.5rem", color: "#666" }}>
          This task was reclaimed after a missed deadline. Workers who defaulted may be barred from
          re-bidding.
        </p>
      )}
    </main>
  );
}
