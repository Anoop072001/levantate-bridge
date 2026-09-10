"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { useAccount } from "wagmi";
import { ChangePayoutWallet } from "@/components/ChangePayoutWallet";
import { ConnectCta } from "@/components/ConnectCta";
import { PageFrame } from "@/components/PageFrame";
import {
  ARC_EXPLORER,
  fetchRegisteredPayout,
  fetchWorkerBalance,
  usdcMicroToDisplay,
} from "@/lib/api";
import { shortAddress, usdcParts } from "@/lib/task-display";
import { payoutSessionLabel } from "@/lib/payout-session";
import { clearWorkerSession } from "@/lib/worker-session";
import { useWorkerSession } from "@/lib/use-worker-session";

export default function WalletPage() {
  const { session, ready, clearedStale } = useWorkerSession();
  const { address: connectedAddress } = useAccount();
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registeredPayout, setRegisteredPayout] = useState<{
    registeredAddress: string;
    nullifierHash: string;
  } | null>(null);
  const registeredSession = useRef<typeof session>(null);

  useEffect(() => {
    if (session?.nullifierHash) {
      registeredSession.current = session;
    }
  }, [session]);

  useEffect(() => {
    const nullifierHash =
      session?.nullifierHash ?? registeredSession.current?.nullifierHash;
    if (!nullifierHash) {
      setRegisteredPayout(null);
      return;
    }
    fetchRegisteredPayout({ nullifierHash })
      .then(setRegisteredPayout)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load registration"));
  }, [session?.nullifierHash]);

  const reloadBalance = useCallback(() => {
    if (!session?.walletAddress) return;
    fetchWorkerBalance(session.walletAddress)
      .then(setBalance)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load balance"));
  }, [session?.walletAddress]);

  useEffect(() => {
    reloadBalance();
  }, [reloadBalance]);

  if (!ready) return null;

  const parts = usdcParts(balance ? usdcMicroToDisplay(balance) : "0");
  const mismatch =
    session && connectedAddress
      ? session.walletAddress.toLowerCase() !== connectedAddress.toLowerCase()
      : false;
  const registrationMismatch =
    session &&
    registeredPayout &&
    session.walletAddress.toLowerCase() !== registeredPayout.registeredAddress.toLowerCase();

  return (
    <PageFrame className="max-w-xl">
      <div className="mb-10 space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Your wallet</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          You hold the keys. Levantate has exactly one address for you — the payout address you
          signed with — and it cannot move your funds. Use Connect to add Arc testnet if you need it.
        </p>
      </div>

      <div className="mx-auto w-full max-w-[380px] rounded-[3rem] border border-border/60 bg-zinc-200/70 p-2.5 shadow-sm">
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="overflow-hidden rounded-[2.5rem] border border-white bg-card p-8 pb-10 shadow-sm"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={session?.walletAddress ?? "empty"}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15, ease: "easeInOut" }}
            >
              <div className="mb-10 flex items-center justify-between">
                <span className="text-[1.1rem] font-medium text-muted-foreground/80">
                  {session ? "Payout wallet" : "Not linked"}
                </span>
                <span className="text-[1.1rem] font-medium tracking-widest text-muted-foreground/60">
                  {session ? shortAddress(session.walletAddress) : "••••"}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div className="text-5xl font-bold tracking-tight text-card-foreground">
                  ${parts.whole}
                  <span className="text-4xl font-semibold text-muted-foreground/80">{parts.cents}</span>
                </div>
                {session && (
                  <a
                    href={`${ARC_EXPLORER}/address/${session.walletAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-1 p-1 text-muted-foreground/40 transition-colors hover:text-foreground"
                    aria-label="View on Arc explorer"
                  >
                    <ArrowUpRight className="h-8 w-8" strokeWidth={2.5} />
                  </a>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>
        <div className="flex justify-center py-6">
          <ConnectCta variant="light" />
        </div>
      </div>

      {clearedStale && (
        <p className="mt-8 text-center text-sm text-amber-700">
          A stored payout wallet from a previous session was cleared because it did not match your
          connected wallet.
        </p>
      )}

      {registrationMismatch && (
        <p className="mt-8 text-center text-sm text-amber-700">
          Your browser session shows <code>{shortAddress(session!.walletAddress)}</code>, but your
          World ID is still registered to{" "}
          <code>{shortAddress(registeredPayout!.registeredAddress)}</code>. Signing a new wallet
          alone does not update registration — complete{" "}
          <strong>Change payout wallet</strong> below (sign + Selfie Check).
        </p>
      )}

      {!session ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          After connecting,{" "}
          <Link href="/verify?return=/wallet" className="underline underline-offset-2">
            sign to link this payout address
          </Link>
          .
        </p>
      ) : mismatch ? (
        <p className="mt-8 text-center text-sm text-amber-700">
          Your browser is connected as <code>{shortAddress(connectedAddress!)}</code>, but your
          payout address is <code>{shortAddress(session.walletAddress)}</code>. Earnings go to the
          payout address — switch accounts in your wallet if you expected them to match.
        </p>
      ) : (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {payoutSessionLabel(session)} · USDC on Arc testnet · self-custodied
        </p>
      )}

      {(session?.nullifierHash ?? registeredSession.current?.nullifierHash) ? (
        <ChangePayoutWallet
          session={
            registeredPayout && session
              ? { ...session, walletAddress: registeredPayout.registeredAddress }
              : (session ?? registeredSession.current)!
          }
          onChanged={() => {
            reloadBalance();
            if (session?.nullifierHash) {
              fetchRegisteredPayout({ nullifierHash: session.nullifierHash }).then(setRegisteredPayout);
            }
          }}
        />
      ) : session ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          If you have bid before, signing a new wallet does not update your registered payout. Try
          bidding once (the error will show your registered address), or connect your original payout
          wallet and sign to restore your session.
        </p>
      ) : null}

      {session && (
        <p className="mt-4 text-center">
          <button
            type="button"
            onClick={() => clearWorkerSession()}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Reset stored payout wallet
          </button>
        </p>
      )}

      {error && <p className="mt-4 text-center text-sm text-red-700">{error}</p>}
    </PageFrame>
  );
}
