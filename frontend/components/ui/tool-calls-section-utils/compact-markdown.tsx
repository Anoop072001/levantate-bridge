"use client";

export function CompactMarkdown({ content }: { content: unknown }) {
  const text =
    typeof content === "string"
      ? content
      : JSON.stringify(content, null, 2);

  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-black">
      {text}
    </pre>
  );
}
