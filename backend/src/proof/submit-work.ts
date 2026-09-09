import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventEmitter } from "node:events";
import { Busboy, type BusboyHeaders } from "@fastify/busboy";
import { createArcPublicClient, getEscrowAddress } from "../chain/escrow.js";
import { nowSeconds, readOnChainTask } from "../chain/task-state.js";
import { requireEnv } from "../env.js";
import { enqueueContractCall, pendingHandle } from "../relayer/submit.js";
import {
  findWorkerByNullifier,
  getTask,
  upsertProof,
} from "../store.js";
import { proofHash, serializeProofPayload, type ProofPayload } from "./payload.js";
import { uploadProofFile } from "./storage.js";

export const MAX_PROOF_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/csv",
  "application/csv",
]);

interface ParsedSubmit {
  nullifierHash?: string;
  content?: string;
  link?: string;
  note?: string;
  file?: { name: string; mimeType: string; buffer: Buffer };
}

function parseMultipart(req: IncomingMessage): Promise<ParsedSubmit> {
  return new Promise((resolve, reject) => {
    const result: ParsedSubmit = {};
    const contentType = req.headers["content-type"];
    if (!contentType) {
      reject(new Error("Missing content-type"));
      return;
    }

    const busboy = new Busboy({
      headers: { ...req.headers, "content-type": contentType } as BusboyHeaders,
      limits: { fileSize: MAX_PROOF_FILE_BYTES, files: 1, fields: 8 },
    });

    busboy.on("field", (name, value) => {
      if (name === "nullifierHash") result.nullifierHash = value.trim();
      if (name === "content") result.content = value;
      if (name === "link") result.link = value.trim();
      if (name === "note") result.note = value;
    });

    busboy.on("file", (name, stream, filename, _encoding, mimeType) => {
      if (name !== "file") {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      const fileEvents = stream as unknown as EventEmitter;
      fileEvents.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => reject(new Error(`File exceeds ${MAX_PROOF_FILE_BYTES} byte limit`)));
      fileEvents.on("end", () => {
        result.file = {
          name: filename,
          mimeType,
          buffer: Buffer.concat(chunks),
        };
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => resolve(result));
    req.pipe(busboy);
  });
}

function isAllowedFile(mimeType: string, fileName: string): boolean {
  if (ALLOWED_MIME.has(mimeType)) return true;
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  );
}

async function buildPayload(
  taskId: number,
  round: number,
  input: ParsedSubmit,
): Promise<{ payload: ProofPayload; hash: `0x${string}` }> {
  const text = input.content?.trim() ?? "";
  const link = input.link?.trim();
  const note = input.note?.trim();

  if (input.file) {
    if (text) {
      throw new Error("Submit either written text or a file, not both");
    }
    if (!input.file.buffer.length) {
      throw new Error("Uploaded file is empty");
    }
    if (!isAllowedFile(input.file.mimeType, input.file.name)) {
      throw new Error("Unsupported file type — use PDF, Word, Excel, CSV, or plain text");
    }
    const storagePath = await uploadProofFile(
      taskId,
      round,
      input.file.name,
      input.file.mimeType,
      input.file.buffer,
    );
    const payload: ProofPayload = {
      kind: "file",
      fileName: input.file.name,
      mimeType: input.file.mimeType,
      storagePath,
      sizeBytes: input.file.buffer.length,
      note: note || undefined,
    };
    return { payload, hash: proofHash(payload, input.file.buffer) };
  }

  if (!text) {
    throw new Error("Provide written proof text or upload a file");
  }

  const payload: ProofPayload = { kind: "text", text, link: link || undefined };
  return { payload, hash: proofHash(payload) };
}

export async function handleSubmitWork(
  req: IncomingMessage,
  _res: ServerResponse,
  taskId: number,
  json: (status: number, payload: unknown) => void,
  jsonBody?: unknown,
): Promise<boolean> {
  const client = createArcPublicClient();
  const escrowAddress = getEscrowAddress();
  const relayerWalletId = requireEnv("CIRCLE_RELAYER_WALLET_ID");

  let parsed: ParsedSubmit;
  const contentType = req.headers["content-type"] ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      parsed = await parseMultipart(req);
    } catch (err) {
      json(400, { error: err instanceof Error ? err.message : "Invalid upload" });
      return true;
    }
  } else {
    const input = (jsonBody ?? {}) as {
      nullifierHash?: string;
      content?: string;
      link?: string;
      note?: string;
    };
    parsed = {
      nullifierHash: input.nullifierHash?.trim(),
      content: input.content,
      link: input.link?.trim(),
      note: input.note,
    };
  }

  if (!parsed.nullifierHash) {
    json(400, { error: "nullifierHash required" });
    return true;
  }

  const worker = await findWorkerByNullifier(parsed.nullifierHash);
  if (!worker) {
    json(403, { error: "Worker not verified" });
    return true;
  }

  const task = await getTask(taskId);
  if (!task) {
    json(404, { error: "Task not found" });
    return true;
  }

  const onChain = await readOnChainTask(taskId, client);
  if (onChain.state !== 2) {
    json(409, { error: `Task is ${onChain.stateLabel}; submit only allowed when Assigned` });
    return true;
  }
  if (nowSeconds() > onChain.submissionDeadline) {
    json(409, { error: "Submission deadline has passed" });
    return true;
  }
  if (onChain.assignedWorker.toLowerCase() !== worker.address.toLowerCase()) {
    json(403, { error: "Worker is not assigned to this task" });
    return true;
  }

  let payload: ProofPayload;
  let contentHash: `0x${string}`;
  try {
    const built = await buildPayload(taskId, onChain.round, parsed);
    payload = built.payload;
    contentHash = built.hash;
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : "Invalid proof submission" });
    return true;
  }

  const tx = await enqueueContractCall({
    walletId: relayerWalletId,
    kind: "submit_work",
    expectedEvent: "WorkSubmitted",
    contractAddress: escrowAddress,
    abiFunctionSignature: "submitWork(uint256,bytes32)",
    abiParameters: [taskId, contentHash],
    taskId,
    round: onChain.round,
    worker: worker.address,
  });

  if (tx.status === "failed") {
    json(502, { ...pendingHandle(tx), error: tx.error ?? "submitWork failed" });
    return true;
  }

  await upsertProof({
    taskId,
    round: onChain.round,
    content: serializeProofPayload(payload),
    contentHash,
    createdAt: new Date().toISOString(),
  });

  json(202, { ...pendingHandle(tx), proofKind: payload.kind });
  return true;
}
