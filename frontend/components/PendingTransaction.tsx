"use client";

import { useEffect, useState } from "react";
import { ARC_EXPLORER, fetchTransaction } from "@/lib/api";
import type { RelayedTransaction } from "@/lib/types";

export function PendingTransaction({
  initial,
  onSettled,
}: {
  initial: RelayedTransaction;
  onSettled?: (tx: RelayedTransaction) => void;
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

  const statusColor =
    tx.status === "confirmed" ? "green" : tx.status === "failed" ? "crimson" : "#666";

  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "0.75rem",
        border: "1px solid #ddd",
        borderRadius: 6,
        fontSize: "0.9rem",
      }}
    >
      <p>
        <strong>{tx.kind}</strong> —{" "}
        <span style={{ color: statusColor }}>{tx.status}</span>
      </p>
      {tx.txHash && (
        <p>
          Tx:{" "}
          <a href={`${ARC_EXPLORER}/tx/${tx.txHash}`} target="_blank" rel="noreferrer">
            {tx.txHash.slice(0, 10)}…
          </a>
        </p>
      )}
      {tx.error && <p style={{ color: "crimson" }}>{tx.error}</p>}
      {tx.status === "submitted" && <p style={{ color: "#666" }}>Waiting for on-chain confirmation…</p>}
      {tx.status === "confirmed" && <p style={{ color: "green" }}>Confirmed on-chain</p>}
    </div>
  );
}
