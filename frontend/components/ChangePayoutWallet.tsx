"use client";

import { useRef, useState } from "react";
import { useAccount } from "wagmi";
import { SelfieCheckButton, type SelfieCheckResult } from "@/components/SelfieCheck";
import { LinkWalletButton } from "@/components/LinkWalletButton";
import { changePayoutWallet } from "@/lib/api";
import { changePayoutSignal } from "@/lib/change-payout-signal";
import { insetButtonDarkClass } from "@/lib/cn";
import { shortAddress } from "@/lib/task-display";
import { setWorkerSession } from "@/lib/worker-session";
import type { WorkerSession } from "@/lib/types";

export function ChangePayoutWallet({
  session,
  onChanged,
}: {
  session: WorkerSession;
  onChanged?: () => void;
}) {
  const registeredNullifier = useRef(session.nullifierHash);
  const previousPayoutAddress = useRef(session.walletAddress);
  if (session.nullifierHash) registeredNullifier.current = session.nullifierHash;
  if (session.nullifierHash && session.walletAddress) {
    previousPayoutAddress.current = session.walletAddress;
  }

  const { address: connectedAddress } = useAccount();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const registeredAddress = previousPayoutAddress.current.toLowerCase();
  const connectedLower = connectedAddress?.toLowerCase();
  const newAddress = linkedAddress ?? connectedLower ?? null;
  const sameAsRegistered = Boolean(newAddress && newAddress === registeredAddress);
  const connectedMismatch = Boolean(connectedLower && connectedLower !== registeredAddress);
  const canStartChange = connectedMismatch || Boolean(linkedAddress);
  const readyForSelfie = Boolean(linkToken && newAddress && !sameAsRegistered);

  async function handleSelfie(proof: SelfieCheckResult) {
    if (!linkToken || !newAddress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await changePayoutWallet(newAddress, linkToken, proof);
      setWorkerSession({
        walletAddress: result.walletAddress,
        nullifierHash: result.nullifierHash,
      });
      setSuccess(
        `Payout wallet updated from ${shortAddress(result.previousAddress)} to ${shortAddress(result.walletAddress)}.`,
      );
      setLinkToken(null);
      setLinkedAddress(null);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Change failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4 rounded-2xl border border-border bg-muted/40 p-5 text-left">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">Change payout wallet</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect a new wallet, sign to prove ownership, then pass Selfie Check. Future bids and
          payouts use the new address. Tasks already assigned to{" "}
          <code className="text-foreground">{shortAddress(previousPayoutAddress.current)}</code>{" "}
          still pay there until they complete.
        </p>
      </div>

      {canStartChange ? (
        <div className="flex flex-wrap items-center gap-3">
          <LinkWalletButton
            label="Sign new payout wallet"
            onLinked={(linked) => {
              if (
                linked.nullifierHash &&
                registeredNullifier.current &&
                linked.nullifierHash !== registeredNullifier.current
              ) {
                setError("This wallet belongs to a different World ID.");
                return;
              }
              if (linked.walletAddress.toLowerCase() === registeredAddress) {
                setError("Choose a different wallet than your current payout address.");
                return;
              }
              setError(null);
              setSuccess(null);
              setLinkedAddress(linked.walletAddress);
              setLinkToken(linked.linkToken ?? null);
            }}
            className={insetButtonDarkClass}
          />

          {readyForSelfie && (
            <SelfieCheckButton
              signal={changePayoutSignal(newAddress!)}
              label="Selfie Check to confirm"
              disabled={busy}
              className={insetButtonDarkClass}
              onVerified={handleSelfie}
              onError={(msg) => setError(msg)}
            />
          )}
        </div>
      ) : null}

      {connectedMismatch && connectedAddress && (
        <p className="text-xs text-amber-700">
          Connected as <code className="text-foreground">{shortAddress(connectedAddress)}</code>,
          registered payout is{" "}
          <code className="text-foreground">{shortAddress(registeredAddress)}</code>. Sign the
          connected wallet, then pass Selfie Check to update registration.
        </p>
      )}

      {success && <p className="text-sm text-emerald-700">{success}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
