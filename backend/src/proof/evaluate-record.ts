import type { ProofRecord } from "../store.js";
import { evaluateProof } from "../agent/proof-evaluator.js";
import { extractTextFromFile } from "./extract.js";
import { parseProofContent, type ProofPayload } from "./payload.js";
import { proofDownloadUrl } from "./download-url.js";
import { downloadProofFile } from "./storage.js";

async function materializeForEvaluation(payload: ProofPayload): Promise<string> {
  if (payload.kind === "text") {
    const parts = [`Submission type: written text`, `Content:\n${payload.text}`];
    if (payload.link) parts.push(`Link: ${payload.link}`);
    return parts.join("\n\n");
  }

  const bytes = await downloadProofFile(payload.storagePath);
  const extracted = await extractTextFromFile(bytes, payload.mimeType, payload.fileName);
  const parts = [
    `Submission type: file upload`,
    `File name: ${payload.fileName}`,
    `MIME type: ${payload.mimeType}`,
    `Size bytes: ${payload.sizeBytes}`,
  ];
  if (payload.note) parts.push(`Worker note: ${payload.note}`);
  parts.push(`Extracted file content:\n${extracted || "[empty after extraction]"}`);
  return parts.join("\n\n");
}

/** Loads text or file content, then asks the LLM whether the task is complete. */
export async function evaluateProofRecord(taskDescription: string, proof: ProofRecord) {
  const payload = parseProofContent(proof.content);
  const evaluable = await materializeForEvaluation(payload);
  return evaluateProof(taskDescription, evaluable, payload.kind);
}

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

/** Full proof text for the agent — includes Excel/PDF/Word content extracted from file uploads. */
export async function describeProofForAgent(proof: ProofRecord) {
  const payload = parseProofContent(proof.content);
  if (payload.kind === "text") {
    return {
      kind: "text" as const,
      text: payload.text,
      link: payload.link ?? null,
    };
  }

  try {
    const bytes = await downloadProofFile(payload.storagePath);
    const extractedContent = await extractTextFromFile(bytes, payload.mimeType, payload.fileName);
    return {
      kind: "file" as const,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      note: payload.note ?? null,
      downloadUrl: proofDownloadUrl(proof.taskId, proof.round),
      extractedContent,
    };
  } catch (err) {
    return {
      kind: "file" as const,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      note: payload.note ?? null,
      downloadUrl: proofDownloadUrl(proof.taskId, proof.round),
      extractionError: err instanceof Error ? err.message : "Could not read uploaded file",
    };
  }
}
