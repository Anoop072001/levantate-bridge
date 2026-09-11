"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { ARC_EXPLORER, fetchRelayedTransaction, usdcMicroToDisplay } from "@/lib/api";
import type { RelayedTransaction } from "@/lib/types";
import { cn } from "@/lib/cn";

export function PendingTransaction({
  initial,
  className,
  onSettled,
}: {
  initial: RelayedTransaction;
  className?: string;
  onSettled?: (tx: RelayedTransaction) => void;
}) {
  const [tx, setTx] = useState(initial);

  useEffect(() => {
    setTx(initial);
  }, [initial]);

  useEffect(() => {
    if (tx.status !== "queued" && tx.status !== "submitted") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchRelayedTransaction(tx.transactionId);
        if (cancelled) return;
        setTx(next);
        if (next.status === "confirmed" || next.status === "failed") {
          onSettled?.(next);
        }
      } catch {
        /* keep showing last known state */
      }
    };

    void poll();
    const id = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tx.transactionId, tx.status, onSettled]);

  const bidAmountLabel =
    tx.kind === "place_bid" && tx.amount ? `${usdcMicroToDisplay(tx.amount)} USDC` : null;

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 text-sm", className)}>
      {bidAmountLabel ? (
        <p>
          <strong>Your bid:</strong> {bidAmountLabel}{" "}
          <span
            className={cn(
              tx.status === "confirmed" && "text-emerald-700",
              tx.status === "failed" && "text-red-700",
              tx.status !== "confirmed" && tx.status !== "failed" && "text-muted-foreground",
            )}
          >
            ({tx.status})
          </span>
        </p>
      ) : (
        <p>
          <strong className="capitalize">{tx.kind.replace(/_/g, " ")}</strong> —{" "}
          <span
            className={cn(
              tx.status === "confirmed" && "text-emerald-700",
              tx.status === "failed" && "text-red-700",
              tx.status !== "confirmed" && tx.status !== "failed" && "text-muted-foreground",
            )}
          >
            {tx.status}
          </span>
        </p>
      )}
      {tx.txHash && (
        <p className="mt-2">
          <a
            href={`${ARC_EXPLORER}/tx/${tx.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            View on Arcscan
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </p>
      )}
      {tx.error && <p className="mt-2 text-red-700">{tx.error}</p>}
      {(tx.status === "queued" || tx.status === "submitted") && (
        <p className="mt-2 text-muted-foreground">
          Waiting for Arc RPC receipt…
        </p>
      )}
      {tx.status === "confirmed" && (
        <p className="mt-2 text-emerald-700">
          {bidAmountLabel ? "Bid confirmed on-chain." : "Confirmed on-chain."}
        </p>
      )}
      {tx.status === "failed" && (
        <p className="mt-2 text-red-700">
          Transaction failed or reverted. Check Arcscan for details.
        </p>
      )}
    </div>
  );
}
