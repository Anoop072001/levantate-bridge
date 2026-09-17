import type { ProofRecord } from "../store.js";
import { parseProofContent } from "./payload.js";
import { proofDownloadPath, proofDownloadUrl } from "./download-url.js";
import { downloadProofFile } from "./storage.js";

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
    downloadUrl: proofDownloadPath(proof.taskId, proof.round),
  };
}

async function extractText(bytes: Buffer, mimeType: string, fileName: string): Promise<string> {
  const { extractTextFromFile } = await import("./extract.js");
  return extractTextFromFile(bytes, mimeType, fileName);
}

/** Full proof text for the operator's model — includes Excel/PDF/Word content from file uploads. */
export async function describeProofForAgent(proof: ProofRecord, publicOrigin?: string) {
  const payload = parseProofContent(proof.content);
  const downloadUrl = proofDownloadUrl(proof.taskId, proof.round, publicOrigin);
  if (payload.kind === "text") {
    return {
      kind: "text" as const,
      text: payload.text,
      link: payload.link ?? null,
    };
  }

  try {
    const bytes = await downloadProofFile(payload.storagePath);
    const extractedContent = await extractText(bytes, payload.mimeType, payload.fileName);
    return {
      kind: "file" as const,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      note: payload.note ?? null,
      downloadUrl,
      extractedContent,
    };
  } catch (err) {
    return {
      kind: "file" as const,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      note: payload.note ?? null,
      downloadUrl,
      extractionError: err instanceof Error ? err.message : "Could not read uploaded file",
    };
  }
}
