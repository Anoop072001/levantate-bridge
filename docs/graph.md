# The Graph — integration reference

Levantate Bridge indexes every escrow state transition on **Arc testnet** and queries that data live for **agent budgeting** and **bid scoring**.

**Start here if you are reviewing The Graph integration.**

> **Not used for write confirmation.** Relayed txs are confirmed via **Arc RPC receipts** (`backend/src/chain/wait-receipt.ts`). The subgraph supplies historical signals only; indexing lag does not gate payouts.

## What it does here

| Use | Where in code | GraphQL source |
| --- | ------------- | -------------- |
| **Worker UI task state** | `backend/src/chain/task-view.ts`, `backend/src/subgraph/tasks.ts` | `Task` entity (state, deadlines, round, bids) — one batch query for list/detail |
| **Budget derivation** | `backend/src/agent/budget.ts` | Median paid amount + submission window from `Payment` entities |
| **Bid scoring** | `backend/src/agent/score-bids.ts` | Worker `completionRate`, `missedDeadlines`, historical price median |
| **Winner loop** | `backend/src/agent/runner.ts`, `operations.ts` | Calls `scoreBids` after bid deadline |
| **Agent tools / API** | `backend/src/agent/tools.ts`, `routes/agent.ts` | `score_bids`, `GET /api/agent/budget` |

**Query endpoint:** Graph Network gateway (`GRAPH_QUERY_API_KEY` + `GRAPH_SUBGRAPH_ID`), not the Studio dev URL.

## Subgraph (indexer)

Manifest — `subgraph/subgraph.yaml` (network `arc-testnet`, all eight handlers):

```yaml
network: arc-testnet
source:
  address: "0xc8F1db364B14D7Aa4ea620bF9f649Ef3D7F14d52"
  startBlock: 61231705
eventHandlers:
  - event: TaskPosted(...)
    handler: handleTaskPosted
  - event: BidPlaced(...)
    handler: handleBidPlaced
  # … WorkerAssigned, WorkSubmitted, WorkRejected, PaymentReleased, TaskReclaimed, TaskCancelled
```

Mappings — `subgraph/src/task-escrow.ts` — example worker stats on assign:

```typescript
export function handleWorkerAssigned(event: WorkerAssignedEvent): void {
  recordEscrowEvent("WorkerAssigned", event.params.taskId, event);
  const worker = loadOrCreateWorker(event.params.worker);
  worker.tasksAssigned = worker.tasksAssigned + 1;
  worker.completionRate = completionRate(worker.tasksAssigned, worker.tasksPaid);
  worker.save();
}
```

Schema entities: `subgraph/schema.graphql` — `Task`, `Bid`, `Worker`, `Payment`, `MissedDeadline`, `EscrowEvent`.

Deploy: `subgraph/package.json` → `npm run codegen`, `graph auth`, `npm run deploy`.

## Backend GraphQL client

Gateway URL + Bearer auth — `backend/src/subgraph/client.ts`:

```typescript
const subgraphId = process.env.GRAPH_SUBGRAPH_ID?.trim() || DEFAULT_SUBGRAPH_ID;
return {
  url: `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`,
  apiKey,
};
```

Queries live in `backend/src/agent/queries.ts`:

- `fetchHistoricalPayments()` — paid task amounts for median budget
- `fetchWorkerStatsBatch(addresses)` — completion rate, missed deadlines per worker

## Agent uses subgraph data

Budget before `postTask` — `backend/src/agent/budget.ts`:

```typescript
export async function deriveTaskParams(): Promise<AgentTaskParams> {
  const payments = await fetchHistoricalPayments();
  const medianPaid = medianPaidFromPayments(payments);
  const medianWindow = medianSubmissionWindowFromPayments(payments);
  return {
    maxBudget: medianPaid ?? DEFAULT_BUDGET,
    submissionWindow: medianWindow ?? DEFAULT_SUBMISSION_WINDOW,
    reasoning: { /* median values or defaults */ },
  };
}
```

Bid scoring — `backend/src/agent/score-bids.ts`:

```typescript
export async function scoreBids(bids: BidRecord[], maxBudget: bigint): Promise<BidSelectionResult> {
  const payments = subgraphUp ? await fetchHistoricalPayments() : [];
  const workerStats = subgraphUp ? await fetchWorkerStatsBatch(eligible.map((b) => b.workerAddress)) : [];
  // priceScore, completionScore, missedDeadlinePenalty → totalScore → winner
}
```

Winner selection invokes scoring in `backend/src/agent/operations.ts` → `selectWinner`.

Smoke test: `backend/scripts/test-agent-budget.ts`.

## Key env vars

- `GRAPH_QUERY_API_KEY` — Subgraph Studio → API Keys (Bearer token for gateway)
- `GRAPH_SUBGRAPH_ID` — Network subgraph id (`Fnr7E8tC1HbD1bvdAsTXMwe5R5kZdx98pH1bhmcWWGeL`)
- `GRAPH_AUTH_DEPLOY_KEY` — Studio deploy key only (`graph auth` / `graph deploy`)

## Deploy

```bash
cd subgraph
npm install && npm run codegen
graph auth <GRAPH_AUTH_DEPLOY_KEY>
npm run deploy
```

Publish to the Graph Network for production query throughput; see [`AGENTS.md`](../AGENTS.md) for verified versions.
