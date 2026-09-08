"use client";

import { IDKitRequestWidget, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { backendUrl, worldAppId, worldRpId } from "@/lib/config";
import { verificationPreset } from "@/lib/world-id-preset";

const appId = worldAppId as `app_${string}`;
const rpId = worldRpId as `rp_${string}`;

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
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const signalParam = searchParams.get("signal") ?? "demo-task-0-round-0";

  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [action, setAction] = useState("");
  const [signal, setSignal] = useState(signalParam);
  const [signalToken, setSignalToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const prepare = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${backendUrl}/api/world-id/rp-signature`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signal: signalParam }),
      });
      const data = (await res.json()) as RpSignatureResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch RP signature");

      setRpContext({
        rp_id: data.rp_id,
        nonce: data.nonce,
        created_at: data.created_at,
        expires_at: data.expires_at,
        signature: data.sig,
      });
      setAction(data.action);
      setSignal(data.signal);
      setSignalToken(data.signal_token);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }, [signalParam]);

  useEffect(() => {
    if (!appId || !rpId) {
      setError("Set NEXT_PUBLIC_WORLD_APP_ID and NEXT_PUBLIC_WORLD_RP_ID in .env.local");
    }
  }, [appId, rpId]);

  const handleVerify = async (result: IDKitResult) => {
    const res = await fetch(`${backendUrl}/api/world-id/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rp_id: rpId,
        idkitResponse: result,
        signal,
        signal_token: signalToken,
      }),
    });
    const data = (await res.json()) as {
      error?: string;
      walletAddress?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? "Backend verification failed");
    }
    setStatus(`Verified — worker wallet ${data.walletAddress}`);
  };

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <h1>World ID verification</h1>
      <p>
        Bid signal: <code>{signalParam}</code>
      </p>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Uses <code>orbLegacy</code> preset until Selfie Check access is granted — swap in{" "}
        <code>lib/world-id-preset.ts</code>.
      </p>

      <button type="button" onClick={prepare} disabled={loading || !appId || !rpId}>
        {loading ? "Preparing…" : "Verify with World ID"}
      </button>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {status && <p style={{ color: "green" }}>{status}</p>}

      {rpContext && appId && action && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={appId}
          action={action}
          rp_context={rpContext}
          allow_legacy_proofs
          environment="sandbox"
          preset={verificationPreset(signal)}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
        />
      )}
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <VerifyContent />
    </Suspense>
  );
}
