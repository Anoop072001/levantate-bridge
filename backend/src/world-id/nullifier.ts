export function extractNullifierHash(idkitResponse: {
  responses?: Array<{ nullifier?: string; session_nullifier?: string[] }>;
}): string | undefined {
  const first = idkitResponse.responses?.[0];
  if (!first) return undefined;
  if (first.nullifier) return first.nullifier;
  if (first.session_nullifier?.[0]) return first.session_nullifier[0];
  return undefined;
}
