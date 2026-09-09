import type { ProofRecord } from "../store.js";
import { parseProofContent } from "./payload.js";
import { downloadProofFile } from "./storage.js";

export interface ProofFileDownload {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export async function resolveProofFileDownload(proof: ProofRecord): Promise<ProofFileDownload> {
  const payload = parseProofContent(proof.content);
  if (payload.kind !== "file") {
    throw new Error("This task has a text proof, not a file upload");
  }

  const bytes = await downloadProofFile(payload.storagePath);
  return {
    fileName: payload.fileName,
    mimeType: payload.mimeType || "application/octet-stream",
    bytes,
  };
}
