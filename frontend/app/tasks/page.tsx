"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BidSheet } from "@/components/BidSheet";
import { TaskBoard } from "@/components/TaskBoard";
import { fetchTasks } from "@/lib/api";
import { shortAddress } from "@/lib/task-display";
import { useWorkerSession } from "@/lib/use-worker-session";
import type { Task } from "@/lib/types";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const { session, ready } = useWorkerSession();

  function reload() {
    fetchTasks()
      .then(setTasks)
      .catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <>
      <TaskBoard
        tasks={tasks}
        error={error}
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
      <BidSheet
        task={bidTask}
        open={Boolean(bidTask)}
        onClose={() => setBidTask(null)}
        onSettled={reload}
      />
    </>
  );
}
