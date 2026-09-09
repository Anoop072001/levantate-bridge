import { randomUUID } from "node:crypto";
import { getSupabase } from "../db/supabase.js";

export const PROOF_FILES_BUCKET = "proof-files";

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "upload";
  const cleaned = base.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120);
  return cleaned || "upload";
}

export async function uploadProofFile(
  taskId: number,
  round: number,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
): Promise<string> {
  const storagePath = `${taskId}/${round}/${randomUUID()}-${sanitizeFileName(fileName)}`;
  const { error } = await getSupabase()
    .storage.from(PROOF_FILES_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (error) {
    throw new Error(`Proof file upload failed: ${error.message}`);
  }
  return storagePath;
}

export async function downloadProofFile(storagePath: string): Promise<Buffer> {
  const { data, error } = await getSupabase().storage.from(PROOF_FILES_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Proof file download failed: ${error?.message ?? "missing object"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

