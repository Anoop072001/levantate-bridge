"use client";

import { IDKitRequestWidget, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useCallback, useEffect, useState } from "react";
import { backendUrl } from "@/lib/config";
import { verificationPreset } from "@/lib/world-id-preset";

export interface SelfieCheckResult {
  rpId: string;
  idkitResponse: IDKitResult;
  signal: string;
  signalToken: string;
}

interface RpSignatureResponse {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  action: string;
  app_id: string;
  rp_id: string;
  signal: string;
  signal_token: string;
  error?: string;
}

interface Props {
  /** What this proof authorizes. The backend re-derives it and rejects a mismatch. */
  signal: string;
  label: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
  onVerified: (result: SelfieCheckResult) => Promise<void> | void;
  onError?: (message: string) => void;
}

/**
 * Runs one Selfie Check bound to `signal`. Each press produces a fresh proof: the backend
 * spends it once, so a verification cannot be replayed across bids.
 */
export function SelfieCheckButton({
  signal,
  label,
  disabled,
  className,
  children,
  onVerified,
  onError,
}: Props) {
  const [config, setConfig] = useState<{ appId: string; rpId: string } | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [action, setAction] = useState("");
  const [issuedSignal, setIssuedSignal] = useState("");
  const [signalToken, setSignalToken] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${backendUrl}/api/world-id/config`)
      .then(async (res) => {
        const data = (await res.json()) as { appId?: string; rpId?: string; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load World ID config");
        if (!data.appId || !data.rpId) throw new Error("Backend returned empty World ID config");
        setConfig({ appId: data.appId, rpId: data.rpId });
      })
      .catch((err) => {
        setConfigError(err instanceof Error ? err.message : "Could not load World ID config");
      });
  }, []);

  const prepare = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/api/world-id/rp-signature`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signal }),
      });
      const data = (await res.json()) as RpSignatureResponse;
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch RP signature");

      setRpContext({
        rp_id: data.rp_id,
        nonce: data.nonce,
        created_at: data.created_at,
        expires_at: data.expires_at,
        signature: data.sig,
      });
      setAction(data.action);
      setIssuedSignal(data.signal);
      setSignalToken(data.signal_token);
      setOpen(true);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not start Selfie Check");
    } finally {
      setLoading(false);
    }
  }, [config, signal, onError]);

  return (
    <>
      <button
        type="button"
        onClick={prepare}
        disabled={disabled || loading || !config}
        className={className}
      >
        {children ?? (loading ? "Preparing…" : label)}
      </button>

      {configError && <p className="mt-2 text-sm text-red-700">{configError}</p>}

      {rpContext && config && action && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={config.appId as `app_${string}`}
          action={action}
          rp_context={rpContext}
          allow_legacy_proofs
          environment="sandbox"
          preset={verificationPreset(issuedSignal)}
          handleVerify={async (result: IDKitResult) => {
            try {
              await Promise.resolve(
                onVerified({
                  rpId: config.rpId,
                  idkitResponse: result,
                  signal: issuedSignal,
                  signalToken,
                }),
              );
              setOpen(false);
            } catch (err) {
              const message = err instanceof Error ? err.message : "Bid failed after Selfie Check";
              onError?.(message);
              setOpen(false);
              // Do not rethrow — IDKit would replace this with "Verification declined".
            }
          }}
          onSuccess={() => setOpen(false)}
        />
      )}
    </>
  );
}
