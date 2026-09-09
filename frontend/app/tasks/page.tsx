"use client";

import Link from "next/link";
import { BidSheet } from "@/components/BidSheet";
import { TaskBoard } from "@/components/TaskBoard";
import { useTasksQuery } from "@/lib/queries";
import { shortAddress } from "@/lib/task-display";
import { useWorkerSession } from "@/lib/use-worker-session";
import type { Task } from "@/lib/types";
import { useState } from "react";

export default function TasksPage() {
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const { session, ready } = useWorkerSession();
  const { data: tasks = [], error, isPending } = useTasksQuery();

  const rpcStale = tasks.some((t) => t.stale);

  return (
    <>
      {rpcStale && (
        <p className="mb-4 rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Arc RPC is slow or unavailable — showing last known task state. Refresh to retry a live
          read.
        </p>
      )}
      <TaskBoard
        tasks={tasks}
        loading={isPending}
        error={error instanceof Error ? error.message : error ? "Load failed" : null}
        onBid={setBidTask}
        sessionHint={
          ready ? (
            session ? (
              <p className="text-sm text-muted-foreground">
                Payout wallet <code className="text-foreground">{shortAddress(session.walletAddress)}</code>
                {session.nullifierHash ? "" : " — Selfie Check still required to bid"}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect a payout wallet before your first bid.{" "}
                <Link href="/verify?return=/tasks" className="underline underline-offset-2">
                  Link wallet
                </Link>
                . Every bid still needs a fresh Selfie Check.
              </p>
            )
          ) : null
        }
      />
      <BidSheet task={bidTask} open={Boolean(bidTask)} onClose={() => setBidTask(null)} />
    </>
  );
}
