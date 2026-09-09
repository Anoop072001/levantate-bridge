"use client";

import { useEffect, useState } from "react";
import { ARC_EXPLORER, fetchTransaction } from "@/lib/api";
import type { RelayedTransaction } from "@/lib/types";
import { cn } from "@/lib/cn";

export function PendingTransaction({
  initial,
  onSettled,
  className,
}: {
  initial: RelayedTransaction;
  onSettled?: (tx: RelayedTransaction) => void;
  className?: string;
}) {
  const [tx, setTx] = useState(initial);

  useEffect(() => {
    if (tx.status === "confirmed" || tx.status === "failed") {
      onSettled?.(tx);
      return;
    }

    const poll = async () => {
      try {
        const updated = await fetchTransaction(tx.transactionId);
        setTx(updated);
        if (updated.status === "confirmed" || updated.status === "failed") {
          onSettled?.(updated);
        }
      } catch {
        /* keep polling */
      }
    };

    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [tx.transactionId, tx.status, onSettled]);

  const statusClass =
    tx.status === "confirmed"
      ? "text-emerald-700"
      : tx.status === "failed"
        ? "text-red-700"
        : "text-muted-foreground";

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 text-sm", className)}>
      <p>
        <strong className="capitalize">{tx.kind}</strong> —{" "}
        <span className={statusClass}>{tx.status}</span>
      </p>
      {tx.txHash && (
        <p className="mt-1">
          Tx:{" "}
          <a
            href={`${ARC_EXPLORER}/tx/${tx.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {tx.txHash.slice(0, 10)}…
          </a>
        </p>
      )}
      {tx.error && <p className="mt-1 text-red-700">{tx.error}</p>}
      {tx.status === "submitted" && (
        <p className="mt-1 text-muted-foreground">Waiting for on-chain confirmation…</p>
      )}
      {tx.status === "confirmed" && <p className="mt-1 text-emerald-700">Confirmed on-chain</p>}
    </div>
  );
}
