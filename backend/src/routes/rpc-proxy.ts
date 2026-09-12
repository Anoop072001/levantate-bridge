import type { IncomingMessage, ServerResponse } from "node:http";
import { getArcRpcUrl } from "../chain/rpc-url.js";

/** Read-only JSON-RPC methods the wallet UI may request through the backend proxy. */
const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionCount",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "net_version",
]);

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
};

function rejectMethod(id: number | string | undefined, method: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32601, message: `Method not allowed via proxy: ${method}` },
  };
}

function isAllowedRequest(req: JsonRpcRequest): boolean {
  const method = req.method?.trim();
  return Boolean(method && ALLOWED_METHODS.has(method));
}

export async function handleRpcProxyRoute(
  req: IncomingMessage,
  pathname: string,
  res: ServerResponse,
  send: (status: number, body: unknown) => void,
  body: unknown,
): Promise<boolean> {
  if (req.method !== "POST" || pathname !== "/api/rpc") {
    return false;
  }

  const upstream = getArcRpcUrl();
  const payload = body as JsonRpcRequest | JsonRpcRequest[];

  if (Array.isArray(payload)) {
    if (!payload.every(isAllowedRequest)) {
      send(403, { error: "Batch contains disallowed JSON-RPC method" });
      return true;
    }
  } else if (!isAllowedRequest(payload)) {
    send(403, {
      error: `Disallowed JSON-RPC method: ${payload.method ?? "unknown"}`,
      result: rejectMethod(payload.id, payload.method ?? "unknown"),
    });
    return true;
  }

  try {
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      "content-type": "application/json",
      "access-control-allow-origin": process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end(text);
  } catch (err) {
    send(502, {
      error: err instanceof Error ? err.message : "Arc RPC proxy failed",
    });
  }

  return true;
}
