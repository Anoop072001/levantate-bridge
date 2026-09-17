const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function backendOrigin(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
    "http://127.0.0.1:3001";
  return raw.replace(/\/$/, "");
}

function copyHeaders(from: Headers, extraSkip: string[] = []): Headers {
  const skip = new Set([...HOP_BY_HOP, ...extraSkip.map((name) => name.toLowerCase())]);
  const headers = new Headers();
  from.forEach((value, key) => {
    if (skip.has(key.toLowerCase())) return;
    headers.append(key, value);
  });
  return headers;
}

/** Reverse-proxy a request to the backend, preserving the public site host for OAuth. */
export async function handleBackendProxy(req: Request): Promise<Response> {
  const incoming = new URL(req.url);
  const dest = `${backendOrigin()}${incoming.pathname}${incoming.search}`;
  const headers = copyHeaders(req.headers);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  if (incoming.protocol === "https:") headers.set("x-forwarded-ssl", "on");

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(dest, init);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Backend unreachable" },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyHeaders(upstream.headers, ["content-encoding"]),
  });
}

export const GET = handleBackendProxy;
export const POST = handleBackendProxy;
export const PUT = handleBackendProxy;
export const PATCH = handleBackendProxy;
export const DELETE = handleBackendProxy;
export const HEAD = handleBackendProxy;
export const OPTIONS = handleBackendProxy;
