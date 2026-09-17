/** Public site origin for proof download links (frontend URL; it reverse-proxies `/api`). */
export function publicBackendUrl(): string {
  return process.env.PUBLIC_BACKEND_URL?.trim().replace(/\/$/, "") || "http://localhost:3000";
}

export function proofDownloadUrl(taskId: number, round: number): string {
  return `${publicBackendUrl()}/api/tasks/${taskId}/proof/download?round=${round}`;
}
