import { querySubgraph } from "./client.js";

const ESCROW_EVENT_QUERY = `
  query ($hash: Bytes!, $kind: String!) {
    escrowEvents(where: { transactionHash: $hash, kind: $kind }, first: 1) { id }
  }`;

export async function subgraphHasExpectedEvent(
  expectedEvent: string,
  txHash: string,
): Promise<boolean> {
  const data = await querySubgraph<{ escrowEvents: Array<{ id: string }> }>(ESCROW_EVENT_QUERY, {
    hash: txHash.toLowerCase(),
    kind: expectedEvent,
  });
  return data.escrowEvents.length > 0;
}
