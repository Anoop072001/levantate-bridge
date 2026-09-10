import { createServer } from "node:http";
import { URL } from "node:url";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { isAddress } from "viem";
import { loadRootEnv, requireEnv } from "./env.js";
import { reconcileSubmittedTransactions } from "./relayer/reconcile.js";
import { handleAgentRoute } from "./routes/agent.js";
import { handleTasksRoute } from "./routes/tasks.js";
import { handleWorkerRoute } from "./routes/worker.js";
import { createWalletChallenge, consumeWalletChallenge } from "./wallet/challenge.js";
import { createSignalToken, registerExpectedSignal } from "./world-id/signals.js";
import {
  findWorkerByAddress,
  upsertLinkedWallet,
} from "./store.js";

loadRootEnv();
void reconcileSubmittedTransactions().then((n) => {
  if (n > 0) console.log(`[relayer] reconciled ${n} submitted transaction(s) via RPC receipt`);
});
if (process.env.AGENT_WINNER_LOOP !== "false") {
  void import("./agent/winner-loop.js").then((m) => m.startWinnerSelectionLoop());
}

const PORT = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 3001);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": FRONTEND_ORIGIN,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
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
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (status: number, body: unknown) => json(res, status, body);

  if (req.method === "GET" && url.pathname === "/health") {
    const { getSubgraphStatus } = await import("./subgraph/client.js");
    send(200, { ok: true, subgraph: getSubgraphStatus() });
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

  const isMultipartSubmit =
    req.method === "POST" &&
    /^\/api\/tasks\/\d+\/submit$/.test(url.pathname) &&
    (req.headers["content-type"] ?? "").includes("multipart/form-data");

  const body =
    req.method === "POST" && !isMultipartSubmit ? await readBody(req) : undefined;

  try {
    if (await handleAgentRoute(req, res, url, body, send)) return;
    if (await handleTasksRoute(req, res, url, body, send)) return;
    if (await handleWorkerRoute(req, res, url, body, send)) return;
  } catch (err) {
    send(500, { error: err instanceof Error ? err.message : "Request failed" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/wallet/challenge") {
    const payload = body as { address?: string };
    const address = payload.address?.trim();
    if (!address || !isAddress(address)) {
      send(400, { error: "A valid wallet address is required" });
      return;
    }

    send(200, createWalletChallenge(address));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/wallet/link") {
    try {
      const payload = body as {
        address?: string;
        signature?: string;
        challengeToken?: string;
      };
      const address = payload.address?.trim();
      const signature = payload.signature?.trim();
      const challengeToken = payload.challengeToken?.trim();
      if (!address || !signature || !challengeToken) {
        send(400, { error: "address, signature, and challengeToken are required" });
        return;
      }
      if (!isAddress(address)) {
        send(400, { error: "Invalid wallet address" });
        return;
      }

      const ownsWallet = await consumeWalletChallenge(challengeToken, address, signature);
      if (!ownsWallet) {
        send(400, { error: "Wallet signature did not match the issued challenge" });
        return;
      }

      const existing = await findWorkerByAddress(address);
      if (existing) {
        send(200, {
          walletAddress: existing.address,
          nullifierHash: existing.nullifierHash,
          alreadyBound: true,
        });
        return;
      }

      const linked = await upsertLinkedWallet(address);
      send(200, {
        walletAddress: linked.address,
        linkToken: linked.linkToken,
        alreadyBound: false,
      });
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : "Wallet link failed" });
    }
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
      await registerExpectedSignal(signalToken, signal);

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

  send(404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
