import type { ProofRecord } from "../store.js";
import { parseProofContent } from "./payload.js";
import { proofDownloadUrl } from "./download-url.js";

/** Lightweight proof metadata for API responses — no file parsers loaded. */
export async function describeProofForApi(proof: ProofRecord) {
  const payload = parseProofContent(proof.content);
  if (payload.kind === "text") {
    return {
      kind: "text" as const,
      text: payload.text,
      link: payload.link ?? null,
    };
  }

  return {
    kind: "file" as const,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    note: payload.note ?? null,
    downloadUrl: proofDownloadUrl(proof.taskId, proof.round),
  };
}
