export function proofDownloadPath(taskId: number, round: number): string {
  return `/api/tasks/${taskId}/proof/download?round=${round}`;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return true;
  }
}

/**
 * Absolute proof URL for remote MCP clients. Loopback origins (and an unset env) return null —
 * Claude/ChatGPT cannot fetch localhost.
 */
export function proofDownloadUrl(taskId: number, round: number, publicOrigin?: string): string | null {
  const origin = (publicOrigin || process.env.PUBLIC_BACKEND_URL || "").trim().replace(/\/$/, "");
  if (!origin || isLoopbackOrigin(origin)) return null;
  return `${origin}${proofDownloadPath(taskId, round)}`;
}
