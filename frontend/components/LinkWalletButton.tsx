"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { linkPayoutWallet } from "@/lib/link-wallet";
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
  render?: (state: { onClick: () => void; busy: boolean; connected: boolean }) => React.ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSign() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const session = await linkPayoutWallet(address, (message) => signMessageAsync({ message }));
      onLinked?.(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet link failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConnectButton.Custom>
      {({ account, openConnectModal, mounted }) => {
        const connected = Boolean(account) || isConnected;
        const onClick = () => {
          if (!connected) openConnectModal();
          else void onSign();
        };

        if (render) {
          return (
            <div>
              <button type="button" onClick={onClick} disabled={busy || !mounted} className={className}>
                {render({ onClick, busy, connected })}
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
              disabled={busy || !mounted}
              className={className ?? insetButtonDarkClass}
            >
              {busy ? "Waiting for signature…" : connected ? label : "Connect wallet"}
            </button>
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
