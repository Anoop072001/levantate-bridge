"use client";

import { IDKitRequestWidget, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { backendUrl } from "@/lib/config";
import { setWorkerSession } from "@/lib/worker-session";
import { verificationPreset } from "@/lib/world-id-preset";

interface WorldIdConfig {
  appId: string;
  rpId: string;
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
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const signalParam = searchParams.get("signal") ?? "demo-task-0-round-0";

  const [config, setConfig] = useState<WorldIdConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [action, setAction] = useState("");
  const [signal, setSignal] = useState(signalParam);
  const [signalToken, setSignalToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${backendUrl}/api/world-id/config`)
      .then(async (res) => {
        const data = (await res.json()) as WorldIdConfig & { error?: string };
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
  }, [config, signalParam]);

  const handleVerify = async (result: IDKitResult) => {
    if (!config) return;
    const res = await fetch(`${backendUrl}/api/world-id/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rp_id: config.rpId,
        idkitResponse: result,
        signal,
        signal_token: signalToken,
      }),
    });
    const data = (await res.json()) as {
      error?: string;
      walletAddress?: string;
      nullifierHash?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? "Backend verification failed");
    }
    if (data.nullifierHash && data.walletAddress) {
      setWorkerSession({
        nullifierHash: data.nullifierHash,
        walletAddress: data.walletAddress,
      });
    }
    setStatus(`Verified — worker wallet ${data.walletAddress}`);
    const returnTo = searchParams.get("return");
    if (returnTo?.startsWith("/")) {
      window.location.href = returnTo;
    }
  };

  const ready = Boolean(config?.appId && config?.rpId);

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <h1>World ID verification</h1>
      <p>
        Bid signal: <code>{signalParam}</code>
      </p>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Selfie Check (sandbox). Complete verification in the World App on your phone.
      </p>

      {!config && !configError && <p>Loading World ID config…</p>}

      <button type="button" onClick={prepare} disabled={loading || !ready}>
        {loading ? "Preparing…" : "Verify with World ID"}
      </button>

      {configError && <p style={{ color: "crimson" }}>{configError}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {status && <p style={{ color: "green" }}>{status}</p>}

      {rpContext && config && action && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={config.appId as `app_${string}`}
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
