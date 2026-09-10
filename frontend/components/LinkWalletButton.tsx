"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { isPayoutReady, needsPayoutChange } from "@/lib/payout-session";
import { linkPayoutWallet } from "@/lib/link-wallet";
import { useRegisteredPayout } from "@/lib/use-registered-payout";
import { useWorkerSession } from "@/lib/use-worker-session";
import type { WorkerSession } from "@/lib/types";
import { insetButtonDarkClass } from "@/lib/cn";

export function LinkWalletButton({
  label = "Sign to prove this wallet is yours",
  onLinked,
  className,
  render,
}: {
  label?: string;
  onLinked?: (session: WorkerSession) => void;
  className?: string;
  render?: (state: {
    onClick: () => void;
    busy: boolean;
    connected: boolean;
    linked: boolean;
    label: string;
  }) => React.ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const { session } = useWorkerSession();
  const { registeredPayout } = useRegisteredPayout(session?.nullifierHash, address);
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payoutChangeNeeded = needsPayoutChange(registeredPayout, address, session);
  const linked = isPayoutReady(session, address, registeredPayout);

  async function onSign() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const next = await linkPayoutWallet(address, (message) => signMessageAsync({ message }));
      onLinked?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet link failed");
    } finally {
      setBusy(false);
    }
  }

  function buttonLabel(connected: boolean): string {
    if (busy) return "Signing…";
    if (!connected) return "Connect";
    if (payoutChangeNeeded) return "Sign new wallet";
    if (linked) return "Linked";
    return "Sign to link";
  }

  return (
    <ConnectButton.Custom>
      {({ account, openConnectModal, mounted }) => {
        const connected = Boolean(account) || isConnected;
        const onClick = () => {
          if (!connected) openConnectModal();
          else if (!linked || payoutChangeNeeded) void onSign();
        };
        const text = buttonLabel(connected);

        if (render) {
          return (
            <div>
              <button
                type="button"
                onClick={onClick}
                disabled={busy || !mounted || (connected && linked && !payoutChangeNeeded)}
                className={className}
              >
                {render({ onClick, busy, connected, linked, label: text })}
              </button>
              {error && <p className="mt-2 text-center text-xs text-red-700">{error}</p>}
            </div>
          );
        }

        return (
          <div>
            <button
              type="button"
              onClick={onClick}
              disabled={busy || !mounted || (connected && linked && !payoutChangeNeeded)}
              className={className ?? insetButtonDarkClass}
            >
              {connected && linked && !payoutChangeNeeded ? label : text}
            </button>
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
