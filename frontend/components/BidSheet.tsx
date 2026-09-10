"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, ScanFace, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";
import { SelfieCheckButton, type SelfieCheckResult } from "@/components/SelfieCheck";
import { LinkWalletButton } from "@/components/LinkWalletButton";
import { PendingTransaction } from "@/components/PendingTransaction";
import { bidSignal } from "@/lib/bid-signal";
import { placeBid, usdcDisplayToMicro, usdcMicroToDisplay } from "@/lib/api";
import { useInvalidateTaskData } from "@/lib/queries";
import { isBiddingOpen } from "@/lib/task-status";
import { cn } from "@/lib/cn";
import { shortAddress, taskHeadline, usdcParts } from "@/lib/task-display";
import { ChangePayoutWallet } from "@/components/ChangePayoutWallet";
import { isPayoutReady, needsPayoutChange } from "@/lib/payout-session";
import { setRegisteredNullifier } from "@/lib/registered-nullifier";
import { setWorkerSession } from "@/lib/worker-session";
import { useRegisteredPayout } from "@/lib/use-registered-payout";
import { useWorkerSession } from "@/lib/use-worker-session";
import type { RelayedTransaction, Task } from "@/lib/types";

export function BidSheet({
  task,
  open,
  onClose,
  onSubmitted,
}: {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onSubmitted?: (tx: RelayedTransaction) => void;
}) {
  const invalidateTasks = useInvalidateTaskData();
  const { session, ready, clearedStale, connectedAddress } = useWorkerSession();
  const { registeredPayout } = useRegisteredPayout(session?.nullifierHash, connectedAddress);
  const [activeDot, setActiveDot] = useState(0);
  const [bidAmount, setBidAmount] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<RelayedTransaction | null>(null);

  const maxDisplay = task ? usdcMicroToDisplay(task.maxBudget) : "0.00";
  const bidMicro = bidAmount ? usdcDisplayToMicro(bidAmount) : 0;
  const canBid = Boolean(task && isBiddingOpen(task));
  const bidAmountValid = canBid && bidMicro > 0 && bidMicro <= Number(task?.maxBudget ?? 0);
  const payoutChangeNeeded = needsPayoutChange(registeredPayout, connectedAddress, session);
  const payoutReady = isPayoutReady(session, connectedAddress, registeredPayout);
  const needsWalletLink = ready && !payoutReady && !payoutChangeNeeded;

  const slides = useMemo(() => {
    if (!task) return [];
    const amountParts = usdcParts(bidAmount || "0");
    const budgetParts = usdcParts(maxDisplay);
    return [
      {
        id: 0,
        name: "Your bid",
        number: `Round ${task.round}`,
        whole: amountParts.whole,
        cents: amountParts.cents,
        editable: true,
      },
      {
        id: 1,
        name: "Max budget",
        number: "USDC on Arc",
        whole: budgetParts.whole,
        cents: budgetParts.cents,
        editable: false,
      },
      {
        id: 2,
        name: "Payout wallet",
        number: session ? shortAddress(session.walletAddress) : "Not linked",
        whole: session ? shortAddress(session.walletAddress).slice(0, 7) : "—",
        cents: "",
        editable: false,
      },
    ];
  }, [task, bidAmount, maxDisplay, session]);

  const active = slides[activeDot] ?? slides[0];

  async function handleBid(proof: SelfieCheckResult) {
    if (!task) return;
    setActionError(null);
    if (!isPayoutReady(session, connectedAddress, registeredPayout)) {
      setActionError(
        payoutChangeNeeded
          ? "Your World ID is registered to a different payout address. Complete Change payout wallet below (sign + Selfie Check) before bidding."
          : "Link your payout wallet first — tap Wallet, connect, and sign. Selfie Check cannot run until that is done.",
      );
      return;
    }
    try {
      const tx = await placeBid(task.id, bidMicro, proof, {
        walletAddress: registeredPayout?.registeredAddress ?? session!.walletAddress,
        linkToken: session!.linkToken,
      });
      if (tx.walletAddress) {
        setWorkerSession({
          walletAddress: tx.walletAddress,
          nullifierHash: tx.nullifierHash,
        });
      }
      setPendingTx(tx);
      setBidAmount("");
      onSubmitted?.(tx);
    } catch (err) {
      const e = err as Error & { registeredAddress?: string; nullifierHash?: string };
      if (e.registeredAddress) {
        if (e.nullifierHash) {
          setRegisteredNullifier(e.nullifierHash);
        }
        setWorkerSession({
          walletAddress: e.registeredAddress,
          nullifierHash: e.nullifierHash,
        });
        setActionError(
          `${e.message} Complete Change payout wallet below (sign + Selfie Check) before bidding again.`,
        );
      } else {
        setActionError(err instanceof Error ? err.message : "Bid failed");
      }
    }
  }

  function resetAndClose() {
    setActiveDot(0);
    setActionError(null);
    setPendingTx(null);
    setBidAmount("");
    onClose();
  }

  return (
    <AnimatePresence>
      {open && task && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={resetAndClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[380px]"
          >
            <button
              type="button"
              onClick={resetAndClose}
              className="absolute -top-10 right-1 text-white/70 transition-colors hover:text-white"
              aria-label="Close bid sheet"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="w-full rounded-[3rem] border border-border/30 bg-muted p-2.5 shadow-sm">
              <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="overflow-hidden rounded-[2.5rem] border border-border/50 bg-card p-8 pb-10 shadow-sm"
              >
                <p className="mb-6 text-sm leading-snug text-muted-foreground">{taskHeadline(task.description)}</p>
                <AnimatePresence mode="wait">
                  {active && (
                    <motion.div
                      key={active.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.15, ease: "easeInOut" }}
                    >
                      <div className="mb-10 flex items-center justify-between">
                        <span className="text-[1.1rem] font-medium text-muted-foreground/80">{active.name}</span>
                        <span className="text-[1.1rem] font-medium tracking-widest text-muted-foreground/60">
                          {active.number}
                        </span>
                      </div>

                      <div className="flex items-end justify-between">
                        {active.editable ? (
                          <label className="flex min-w-0 items-end text-card-foreground">
                            <span className="text-5xl font-bold tracking-tight">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={maxDisplay}
                              value={bidAmount}
                              onChange={(e) => setBidAmount(e.target.value)}
                              placeholder="0.00"
                              className="w-[7.5ch] bg-transparent text-5xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/35"
                            />
                          </label>
                        ) : (
                          <div className="text-5xl font-bold tracking-tight text-card-foreground">
                            {active.id === 2 ? active.whole : `$${active.whole}`}
                            <span className="text-4xl font-semibold text-muted-foreground/80">{active.cents}</span>
                          </div>
                        )}
                        <a
                          href={`/tasks/${task.id}`}
                          className="mb-1 p-1 text-muted-foreground/40 transition-colors hover:text-foreground"
                          aria-label="Open task"
                        >
                          <ArrowUpRight className="h-8 w-8" strokeWidth={2.5} />
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              <div className="flex items-center justify-center gap-2 py-6">
                {slides.map((slide, idx) => (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => setActiveDot(idx)}
                    className="relative flex h-4 cursor-pointer items-center justify-center"
                    aria-label={`Go to slide ${idx + 1}`}
                  >
                    <motion.div
                      layout
                      className={cn(
                        "rounded-full",
                        activeDot === idx ? "h-1.5 w-5 bg-foreground/40" : "h-1.5 w-1.5 bg-foreground/20",
                      )}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  </button>
                ))}
              </div>

              {pendingTx ? (
                <div className="px-4 pb-6">
                  <PendingTransaction
                    initial={pendingTx}
                    onSettled={() => task && invalidateTasks(task.id)}
                  />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 px-4 pt-1 pb-4">
                    <LinkWalletButton
                      className="group flex cursor-pointer flex-col items-center gap-3"
                      onLinked={() => setActionError(null)}
                      render={({ onClick, busy, connected, linked, label }) => (
                        <>
                          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/50 bg-card text-foreground shadow-sm transition-all duration-300 group-hover:bg-foreground group-hover:text-background">
                            <Wallet className="h-7 w-7" strokeWidth={2.5} />
                          </div>
                          <span className="text-[15px] font-medium text-foreground/80 transition-colors group-hover:text-foreground">
                            {busy ? "Signing…" : label}
                          </span>
                        </>
                      )}
                    />

                    <SelfieCheckButton
                      signal={bidSignal(task.id, task.round, bidMicro)}
                      label="Selfie Check"
                      disabled={!bidAmountValid || needsWalletLink || payoutChangeNeeded}
                      onVerified={handleBid}
                      onError={setActionError}
                      className="group flex cursor-pointer flex-col items-center gap-3 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/50 bg-card text-foreground shadow-sm transition-all duration-300 group-hover:bg-foreground group-hover:text-background group-disabled:group-hover:bg-card group-disabled:group-hover:text-foreground">
                        <ScanFace className="h-7 w-7" strokeWidth={2.5} />
                      </div>
                      <span className="text-[15px] font-medium text-foreground/80 transition-colors group-hover:text-foreground">
                        Bid
                      </span>
                    </SelfieCheckButton>

                    <button
                      type="button"
                      onClick={resetAndClose}
                      className="group flex cursor-pointer flex-col items-center gap-3"
                    >
                      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/50 bg-card text-foreground shadow-sm transition-all duration-300 group-hover:bg-foreground group-hover:text-background">
                        <ArrowRight className="h-7 w-7" strokeWidth={2.5} />
                      </div>
                      <span className="text-[15px] font-medium text-foreground/80 transition-colors group-hover:text-foreground">
                        Close
                      </span>
                    </button>
                  </div>

                  <p className="px-6 text-center text-xs leading-relaxed text-muted-foreground">
                    {!canBid
                      ? "Bidding is closed on this task."
                      : payoutChangeNeeded
                        ? `Your World ID pays out to ${shortAddress(registeredPayout!.registeredAddress)}. Connect your new wallet, sign, then Selfie Check below to move registration before bidding.`
                        : clearedStale
                          ? "A previous payout wallet was cleared because it did not match your connected wallet. Tap Wallet and sign again."
                          : needsWalletLink
                            ? "First step: tap Wallet, connect, and sign to link your payout address. Then enter an amount and run Selfie Check."
                            : `Enter an amount up to ${maxDisplay} USDC, then Selfie Check to submit.`}
                  </p>

                  {payoutChangeNeeded && registeredPayout && (
                    <div className="mx-4 mt-4">
                      <ChangePayoutWallet
                        session={{
                          walletAddress: registeredPayout.registeredAddress,
                          nullifierHash: registeredPayout.nullifierHash,
                        }}
                        onChanged={() => setActionError(null)}
                      />
                    </div>
                  )}

                  {actionError && (
                    <p
                      role="alert"
                      className="mx-6 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm leading-relaxed text-red-800"
                    >
                      {actionError}
                    </p>
                  )}

                  <div className="pb-6" />
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
