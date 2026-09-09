import { keccak256, toBytes } from "viem";

export type TextProofPayload = {
  kind: "text";
  text: string;
  link?: string;
};

export type FileProofPayload = {
  kind: "file";
  fileName: string;
  mimeType: string;
  storagePath: string;
  sizeBytes: number;
  note?: string;
};

export type ProofPayload = TextProofPayload | FileProofPayload;

export function serializeProofPayload(payload: ProofPayload): string {
  return JSON.stringify(payload);
}

/** Legacy rows stored plain text or `text\\nlink` before structured proofs. */
export function parseProofContent(content: string): ProofPayload {
  try {
    const parsed = JSON.parse(content) as ProofPayload;
    if (parsed.kind === "text" && typeof parsed.text === "string") return parsed;
    if (
      parsed.kind === "file" &&
      typeof parsed.fileName === "string" &&
      typeof parsed.storagePath === "string"
    ) {
      return parsed;
    }
  } catch {
    /* legacy string */
  }

  const linkMatch = content.match(/\n(https?:\/\/\S+)\s*$/);
  if (linkMatch && linkMatch.index !== undefined) {
    return {
      kind: "text",
      text: content.slice(0, linkMatch.index).trim(),
      link: linkMatch[1],
    };
  }

  return { kind: "text", text: content };
}

export function proofHash(payload: ProofPayload, fileBytes?: Buffer): `0x${string}` {
  if (payload.kind === "text") {
    const body = payload.link ? `${payload.text}\n${payload.link}` : payload.text;
    return keccak256(toBytes(body));
  }
  if (!fileBytes) {
    throw new Error("File proof hash requires file bytes");
  }
  return keccak256(fileBytes);
}
