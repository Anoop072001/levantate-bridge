# The Graph — integration reference

Levantate Bridge indexes every escrow state transition on **Arc testnet** and queries that data live for agent budgeting and bid scoring. Confirmation of relayed writes is driven by indexed events (see [`architecture.md`](architecture.md)).

## What it does here

| Use | How |
| --- | --- |
| **Budget derivation** | Median historical payout and submission window before `postTask` |
| **Bid scoring** | Worker completion rate, missed deadlines, price vs historical median |
| **Confirmation** | Relayed txs stay pending until the matching escrow event appears in the index |

**Query endpoint:** Graph Network gateway (`GRAPH_QUERY_API_KEY` + `GRAPH_SUBGRAPH_ID`), not the Studio dev URL.

## Code files

### Subgraph (indexer)

| File | Role |
| ---- | ---- |
| `subgraph/schema.graphql` | Entity schema (`Task`, `Bid`, `Worker`, `Payment`, …) |
| `subgraph/subgraph.yaml` | Manifest — contract address, network `arc-testnet`, event handlers |
| `subgraph/src/task-escrow.ts` | AssemblyScript mappings for all eight escrow events |
| `subgraph/abis/TaskEscrow.json` | ABI copied from contracts build |
| `subgraph/package.json` | `graph codegen`, `graph deploy` scripts |

### Backend (query client + agent)

| File | Role |
| ---- | ---- |
| `backend/src/subgraph/client.ts` | Gateway GraphQL client (Bearer auth, retries, rate-limit cooldown) |
| `backend/src/agent/queries.ts` | `fetchHistoricalPayments`, `fetchWorkerStatsBatch`, median helpers |
| `backend/src/agent/budget.ts` | Derives `maxBudget` / `submissionWindow` from subgraph medians |
| `backend/src/agent/score-bids.ts` | Scores bids using worker stats + payment history |
| `backend/src/agent/runner.ts` | Calls scoring during winner selection |
| `backend/src/agent/operations.ts` | Invokes scoring inside `selectWinner` |
| `backend/src/agent/tools.ts` | MCP/chat `score_bids` tool |
| `backend/src/routes/agent.ts` | `GET /api/agent/budget`, `GET /api/agent/tasks/:id/score-bids` |
| `backend/scripts/test-agent-budget.ts` | Smoke test for budget derivation |

### Environment

| File | Role |
| ---- | ---- |
| `.env.example` | `GRAPH_QUERY_API_KEY`, `GRAPH_SUBGRAPH_ID`, `GRAPH_AUTH_DEPLOY_KEY` |

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
