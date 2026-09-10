const MAX_EXTRACT_CHARS = 24_000;

function clip(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_EXTRACT_CHARS)}\n… [truncated]`;
}

export async function extractTextFromFile(
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const lower = fileName.toLowerCase();

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    const parsed = await parser.getText();
    return clip(parsed.text || "");
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.default.extractRawText({ buffer: bytes });
    return clip(result.value || "");
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls")
  ) {
    const XLSX = await import("@e965/xlsx");
    const workbook = XLSX.read(bytes, { type: "buffer" });
    const chunks: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      chunks.push(`Sheet: ${sheetName}\n${csv}`);
    }
    return clip(chunks.join("\n\n"));
  }

  if (
    mimeType.startsWith("text/") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  ) {
    return clip(bytes.toString("utf8"));
  }

  throw new Error(
    `Unsupported file type (${mimeType || "unknown"}). Upload PDF, Word, Excel, CSV, or plain text.`,
  );
}
