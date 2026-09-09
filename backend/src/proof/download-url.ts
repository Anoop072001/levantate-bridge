/** Public base URL for proof download links returned to the agent and task API. */
export function publicBackendUrl(): string {
  return (
    process.env.PUBLIC_BACKEND_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    `http://localhost:${process.env.BACKEND_PORT ?? 3001}`
  );
}

export function proofDownloadUrl(taskId: number, round: number): string {
  return `${publicBackendUrl()}/api/tasks/${taskId}/proof/download?round=${round}`;
}
