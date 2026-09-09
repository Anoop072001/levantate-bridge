import { createServer } from "node:http";
import { URL } from "node:url";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { loadRootEnv, requireEnv } from "./env.js";
import { createWorkerWallet } from "./circle/create-worker-wallet.js";
import { handleAgentRoute, startAgentLoop } from "./routes/agent.js";
import { handleTasksRoute } from "./routes/tasks.js";
import { extractNullifierHash } from "./world-id/nullifier.js";
import {
  consumeExpectedSignal,
  createSignalToken,
  registerExpectedSignal,
} from "./world-id/signals.js";
import { startConfirmationReconciler } from "./confirmation/reconciler.js";
import { findWorkerByNullifier, insertWorker } from "./store.js";

loadRootEnv();
startConfirmationReconciler();
startAgentLoop();

const PORT = Number(process.env.BACKEND_PORT ?? 3001);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const WORLD_VERIFY_BASE = "https://developer.world.org/api/v4/verify";

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": FRONTEND_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": FRONTEND_ORIGIN,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (status: number, body: unknown) => json(res, status, body);

  if (req.method === "GET" && url.pathname === "/health") {
    send(200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/world-id/config") {
    try {
      send(200, {
        appId: requireEnv("WORLD_APP_ID"),
        rpId: requireEnv("WORLD_RP_ID"),
      });
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : "World ID not configured" });
    }
    return;
  }

  const body = req.method === "POST" ? await readBody(req) : undefined;

  try {
    if (await handleAgentRoute(req, res, url, body, send)) return;
    if (await handleTasksRoute(req, res, url, body, send)) return;
  } catch (err) {
    send(500, { error: err instanceof Error ? err.message : "Request failed" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/world-id/rp-signature") {
    try {
      const payload = body as { signal?: string };
      const signal = payload.signal?.trim();
      if (!signal) {
        send(400, { error: "signal is required" });
        return;
      }

      const action = requireEnv("WORLD_ID_ACTION");
      const { sig, nonce, createdAt, expiresAt } = signRequest({
        signingKeyHex: requireEnv("WORLD_SIGNING_KEY"),
        action,
      });

      const signalToken = createSignalToken();
      registerExpectedSignal(signalToken, signal);

      send(200, {
        sig,
        nonce,
        created_at: createdAt,
        expires_at: expiresAt,
        action,
        app_id: requireEnv("WORLD_APP_ID"),
        rp_id: requireEnv("WORLD_RP_ID"),
        signal,
        signal_token: signalToken,
      });
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : "RP signature failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/world-id/verify") {
    try {
      const payload = body as {
        rp_id?: string;
        idkitResponse?: Record<string, unknown>;
        signal?: string;
        signal_token?: string;
      };

      const rpId = payload.rp_id ?? requireEnv("WORLD_RP_ID");
      const idkitResponse = payload.idkitResponse;
      const signal = payload.signal?.trim();
      const signalToken = payload.signal_token?.trim();

      if (!idkitResponse || !signal || !signalToken) {
        send(400, { error: "idkitResponse, signal, and signal_token are required" });
        return;
      }

      if (!consumeExpectedSignal(signalToken, signal)) {
        send(400, { error: "Signal mismatch or expired session" });
        return;
      }

      const verifyRes = await fetch(`${WORLD_VERIFY_BASE}/${rpId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(idkitResponse),
      });

      if (!verifyRes.ok) {
        const detail = await verifyRes.text();
        send(400, { error: "World ID verification failed", detail });
        return;
      }

      const nullifierHash = extractNullifierHash(
        idkitResponse as { responses?: Array<{ nullifier?: string; session_nullifier?: string[] }> },
      );
      if (!nullifierHash) {
        send(400, { error: "No nullifier in IDKit response" });
        return;
      }

      const existing = findWorkerByNullifier(nullifierHash);
      if (existing) {
        send(409, {
          error: "Duplicate World ID — this identity already has a worker wallet",
          walletAddress: existing.address,
        });
        return;
      }

      const { walletId, address } = await createWorkerWallet(nullifierHash);
      insertWorker({
        nullifierHash,
        circleWalletId: walletId,
        address,
        signal,
        createdAt: new Date().toISOString(),
      });

      send(200, {
        success: true,
        nullifierHash,
        walletId,
        walletAddress: address,
      });
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : "Verification failed" });
    }
    return;
  }

  send(404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
