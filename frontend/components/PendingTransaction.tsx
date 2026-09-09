"use client";

import { ExternalLink } from "lucide-react";
import { ARC_EXPLORER } from "@/lib/api";
import type { RelayedTransaction } from "@/lib/types";
import { cn } from "@/lib/cn";

export function PendingTransaction({
  initial,
  className,
}: {
  initial: RelayedTransaction;
  className?: string;
}) {
  const tx = initial;

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 text-sm", className)}>
      <p>
        <strong className="capitalize">{tx.kind.replace(/_/g, " ")}</strong> —{" "}
        <span className="text-muted-foreground">{tx.status}</span>
      </p>
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
      {tx.status === "submitted" && (
        <p className="mt-2 text-muted-foreground">
          Transaction submitted. Check Arcscan above, then refresh this page to see updated task
          state — like a block explorer.
        </p>
      )}
      {tx.status === "failed" && (
        <p className="mt-2 text-red-700">Submission failed before reaching the chain.</p>
      )}
    </div>
  );
}
