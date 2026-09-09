import { createHash } from "node:crypto";
import { requireEnv } from "../env.js";
import { trySpendProof } from "../store.js";
import { extractNullifierHash } from "./nullifier.js";
import { consumeExpectedSignal } from "./signals.js";

const WORLD_VERIFY_BASE = "https://developer.world.org/api/v4/verify";

export interface ProofSubmission {
  rpId: string;
  idkitResponse: Record<string, unknown>;
  signal: string;
  signalToken: string;
}

export type ProofOutcome =
  | { ok: true; nullifierHash: string }
  | { ok: false; status: number; error: string; detail?: string };

function logVerifyFailure(
  reason: "signal" | "world_api" | "nullifier" | "replay",
  meta: Record<string, unknown>,
): void {
  console.error(`[world-id] verify failed (${reason})`, meta);
}

/** Verifies a Selfie Check proof server-side and spends it so it cannot authorize a second bid. */
export async function verifySelfieCheck(input: ProofSubmission): Promise<ProofOutcome> {
  const action = requireEnv("WORLD_ID_ACTION");

  const signalOk = await consumeExpectedSignal(input.signalToken, input.signal);
  if (!signalOk) {
    logVerifyFailure("signal", {
      rp_id: input.rpId,
      action,
      signal_token: `${input.signalToken.slice(0, 8)}…`,
    });
    return { ok: false, status: 400, error: "Signal mismatch or expired verification session" };
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input.idkitResponse))
    .digest("hex");

  const res = await fetch(`${WORLD_VERIFY_BASE}/${input.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.idkitResponse),
  });
  if (!res.ok) {
    const detail = await res.text();
    logVerifyFailure("world_api", {
      rp_id: input.rpId,
      action,
      http_status: res.status,
      detail,
    });
    return {
      ok: false,
      status: 400,
      error: "World ID verification failed",
      detail,
    };
  }

  const nullifierHash = extractNullifierHash(
    input.idkitResponse as { responses?: Array<{ nullifier?: string; session_nullifier?: string[] }> },
  );
  if (!nullifierHash) {
    logVerifyFailure("nullifier", { rp_id: input.rpId, action });
    return { ok: false, status: 400, error: "No nullifier in IDKit response" };
  }

  const spent = await trySpendProof(fingerprint, nullifierHash);
  if (!spent) {
    logVerifyFailure("replay", {
      rp_id: input.rpId,
      action,
      nullifier: `${nullifierHash.slice(0, 10)}…`,
    });
    return { ok: false, status: 409, error: "This Selfie Check proof has already been used" };
  }

  return { ok: true, nullifierHash };
}
