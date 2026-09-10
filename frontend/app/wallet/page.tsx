"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { useAccount } from "wagmi";
import { ChangePayoutWallet } from "@/components/ChangePayoutWallet";
import { ConnectCta } from "@/components/ConnectCta";
import { PageFrame } from "@/components/PageFrame";
import {
  ARC_EXPLORER,
  fetchWorkerBalance,
  usdcMicroToDisplay,
} from "@/lib/api";
import { needsPayoutChange, payoutSessionLabel } from "@/lib/payout-session";
import { shortAddress, usdcParts } from "@/lib/task-display";
import { useRegisteredPayout } from "@/lib/use-registered-payout";
import { clearWorkerSession } from "@/lib/worker-session";
import { useWorkerSession } from "@/lib/use-worker-session";

export default function WalletPage() {
  const { session, ready, clearedStale } = useWorkerSession();
  const { address: connectedAddress } = useAccount();
  const { registeredPayout, error: registrationError } = useRegisteredPayout(
    session?.nullifierHash,
    connectedAddress,
  );
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayAddress =
    registeredPayout?.registeredAddress ?? session?.walletAddress ?? null;

  const reloadBalance = useCallback(() => {
    const address = registeredPayout?.registeredAddress ?? session?.walletAddress;
    if (!address) return;
    fetchWorkerBalance(address)
      .then(setBalance)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load balance"));
  }, [registeredPayout?.registeredAddress, session?.walletAddress]);

  useEffect(() => {
    reloadBalance();
  }, [reloadBalance]);

  if (!ready) return null;

  const parts = usdcParts(balance ? usdcMicroToDisplay(balance) : "0");
  const mismatch =
    session && connectedAddress
      ? session.walletAddress.toLowerCase() !== connectedAddress.toLowerCase()
      : false;
  const payoutChangeNeeded = needsPayoutChange(registeredPayout, connectedAddress, session);

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
              key={displayAddress ?? "empty"}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15, ease: "easeInOut" }}
            >
              <div className="mb-10 flex items-center justify-between">
                <span className="text-[1.1rem] font-medium text-muted-foreground/80">
                  {displayAddress ? "Registered payout" : "Not linked"}
                </span>
                <span className="text-[1.1rem] font-medium tracking-widest text-muted-foreground/60">
                  {displayAddress ? shortAddress(displayAddress) : "••••"}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div className="text-5xl font-bold tracking-tight text-card-foreground">
                  ${parts.whole}
                  <span className="text-4xl font-semibold text-muted-foreground/80">{parts.cents}</span>
                </div>
                {displayAddress && (
                  <a
                    href={`${ARC_EXPLORER}/address/${displayAddress}`}
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
          connected wallet. If you are a registered worker, use Change payout wallet below.
        </p>
      )}

      {payoutChangeNeeded && registeredPayout && (
        <p className="mt-8 text-center text-sm text-amber-700">
          Your World ID pays out to{" "}
          <code>{shortAddress(registeredPayout.registeredAddress)}</code>
          {session?.walletAddress &&
          session.walletAddress.toLowerCase() !== registeredPayout.registeredAddress.toLowerCase() ? (
            <>
              , but your browser session shows <code>{shortAddress(session.walletAddress)}</code>
            </>
          ) : connectedAddress &&
            connectedAddress.toLowerCase() !== registeredPayout.registeredAddress.toLowerCase() ? (
            <>
              , but you are connected as <code>{shortAddress(connectedAddress)}</code>
            </>
          ) : null}
          . Signing alone does not update registration — complete <strong>Change payout wallet</strong>{" "}
          below (sign + Selfie Check).
        </p>
      )}

      {!session && !registeredPayout ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          After connecting,{" "}
          <Link href="/verify?return=/wallet" className="underline underline-offset-2">
            sign to link this payout address
          </Link>
          .
        </p>
      ) : mismatch && !payoutChangeNeeded ? (
        <p className="mt-8 text-center text-sm text-amber-700">
          Your browser is connected as <code>{shortAddress(connectedAddress!)}</code>, but your
          payout address is <code>{shortAddress(session!.walletAddress)}</code>. Earnings go to the
          payout address — switch accounts in your wallet if you expected them to match.
        </p>
      ) : (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {payoutSessionLabel(session, registeredPayout)} · USDC on Arc testnet · self-custodied
        </p>
      )}

      {registeredPayout ? (
        <ChangePayoutWallet
          session={{
            walletAddress: registeredPayout.registeredAddress,
            nullifierHash: registeredPayout.nullifierHash,
          }}
          onChanged={reloadBalance}
        />
      ) : session ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          First bid binds this wallet to your World ID. If you have bid before on another device,
          connect your registered payout wallet and sign to restore it, or bid once to see your
          registered address.
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

      {(error || registrationError) && (
        <p className="mt-4 text-center text-sm text-red-700">{error ?? registrationError}</p>
      )}
    </PageFrame>
  );
}
