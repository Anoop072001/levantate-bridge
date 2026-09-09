"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTasks, usdcMicroToDisplay } from "@/lib/api";
import { Countdown } from "@/components/Countdown";
import { useWorkerSession } from "@/lib/use-worker-session";
import type { Task } from "@/lib/types";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { session, ready } = useWorkerSession();

  useEffect(() => {
    fetchTasks()
      .then((all) => setTasks(all.filter((t) => t.state === 0 || t.state === 1)))
      .catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1>Open tasks</h1>

      {ready &&
        (session ? (
          <p style={{ fontSize: "0.9rem" }}>
            Verified as <code>{session.walletAddress.slice(0, 10)}…</code>
          </p>
        ) : (
          <p style={{ color: "#666" }}>
            Verify with World ID before bidding.{" "}
            <Link href="/verify?signal=browse&return=/tasks">Verify now</Link>
          </p>
        ))}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {tasks.length === 0 && !error && <p>No open tasks right now.</p>}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {tasks.map((task) => (
          <li
            key={task.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
              <Link href={`/tasks/${task.id}`}>Task #{task.id}</Link>
            </h2>
            <p style={{ margin: "0 0 0.5rem" }}>{task.description}</p>
            <p style={{ margin: 0, fontSize: "0.9rem" }}>
              Budget: {usdcMicroToDisplay(task.maxBudget)} USDC · Round {task.round} ·{" "}
              {task.stateLabel}
            </p>
            <Countdown deadlineUnix={task.bidDeadline} label="Bid closes in" />
          </li>
        ))}
      </ul>
    </main>
  );
}
