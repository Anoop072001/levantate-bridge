# Levantate Bridge — architecture

High-level system design with **sponsor-product labels** on each integration leg. Deep dives: [`graph.md`](graph.md), [`circle-arc.md`](circle-arc.md), [`world-selfie-check.md`](world-selfie-check.md). Requirements: [`spec.md`](spec.md). Ops rules: [`../AGENTS.md`](../AGENTS.md).

## System diagram

```mermaid
flowchart TB
  subgraph Agent["Requesting agent (backend)"]
    AL[Agent loop<br/>budget · bid scoring · proof eval on submit]
    RQ[Relayer queue<br/>serialized nonces · idempotency]
    DB[(Supabase Postgres<br/>workers · tasks · bids · proofs · txs)]
  end

  subgraph Circle["Circle — Agent Stack / Wallets / Arc"]
    AW[Agent Circle Wallet<br/>funds escrow]
    RW[Relayer Circle Wallet<br/>submits placeBid / submitWork]
    ARC[(Arc testnet<br/>USDC escrow)]
  end

  WW[Worker's own wallet<br/>self-custodied · receives USDC]

  subgraph WorldID["World ID — Selfie Check"]
    IDK[IDKit widget<br/>sandbox Selfie Check]
    RP[RP signature + verify<br/>nullifier ↔ address binding]
  end

  subgraph Graph["The Graph — Network gateway"]
    SG[(Subgraph index<br/>8 escrow events)]
    GQL[GraphQL gateway + API key]
  end

  subgraph WorkerUI["Worker frontend (Next.js)"]
    FE[Browse · bid · submit proof<br/>change payout wallet]
  end

  AL -->|"postTask · selectWinner · approveWork · rejectWork · reclaimTask · cancel/abort"| RQ
  RQ --> AW
  RQ --> RW
  AW -->|"USDC lock / refund / payout"| ARC
  RW -->|"placeBid · submitWork (relayed)"| ARC

  FE -->|"connect wallet + personal_sign challenge"| RP
  FE --> IDK
  IDK --> RP
  RP -->|"bind nullifier ↔ payout address"| DB
  FE -->|"bid / submit / change-payout API"| RQ
  RQ --> DB

  AL -->|"historical price · completion rate · missed deadlines"| GQL
  GQL --> SG
  ARC -->|"state transition events"| SG

  ARC -->|"PaymentReleased"| WW
  FE -->|"poll GET /api/transactions/:id"| DB
```

## Flow sequence (happy path)

```mermaid
sequenceDiagram
  participant A as Agent (Circle wallet)
  participant E as Escrow on Arc
  participant W as Worker (World ID + own wallet)
  participant B as Backend relayer
  participant G as The Graph subgraph

  A->>E: postTask (locks maxBudget USDC)
  E-->>G: TaskPosted
  W->>B: connect wallet + sign ownership challenge
  W->>B: placeBid + fresh Selfie Check proof (signal-bound to task/round/amount)
  Note over B: First bid binds nullifier to payout address
  B->>E: placeBid(worker, amount)
  E-->>G: BidPlaced
  A->>G: query worker stats + price history
  A->>E: selectWinner
  E-->>G: WorkerAssigned (submissionDeadline set)
  W->>B: submit proof text
  B->>E: submitWork(proofHash)
  E-->>G: WorkSubmitted
  B->>B: LLM proof evaluation (on submit)
  B->>E: approveWork
  E->>W: USDC winning bid
  E->>A: USDC refund (maxBudget − bid)
  E-->>G: PaymentReleased
```

## Reclaim path (missed submission deadline)

When an assigned worker passes `submissionDeadline` without submitting:

1. Agent calls **`reclaimTask`** manually via `POST /api/tasks/:id/reclaim` (not automatic in the agent loop).
2. Escrow stays locked at `maxBudget`; task returns to **Open** with `round` incremented.
3. Defaulting worker is **barred** from re-bidding that task.
4. Subgraph indexes **`TaskReclaimed`** → **`MissedDeadline`** reputation signal.

## Sponsor mapping

| Sponsor | Role in this repo |
| -------- | ----------------- |
| **Circle** | Developer-controlled **agent wallet** funds escrow; **relayer wallet** submits worker txs so workers never hold gas; `approveWork` settles USDC to the worker's **self-custodied** address. All settlement on **Arc testnet** native USDC (6-decimal ERC-20). |
| **World ID** | **Selfie Check** gates **every bid** and **payout-address changes**. Backend signs **`rp_context`**, verifies at `developer.world.org`, spends each proof once. One nullifier → one payout address at a time (rotatable with fresh Selfie Check). |
| **The Graph** | Subgraph on **`arc-testnet`** indexes all eight escrow events. Agent queries live for budget + bid scoring. Relayed writes are confirmed via Arc RPC receipts, not subgraph indexing lag. |

## Repo layout

| Path | Purpose |
| ---- | ------- |
| `contracts/` | `TaskEscrow.sol`, Forge tests, Arc deploy script |
| `backend/` | Marketplace API, Circle + World ID + agent logic, relayer queue, Supabase |
| `frontend/` | Worker UI — tasks, Selfie Check, bid/submit, payout wallet |
| `subgraph/` | Schema, mappings, Studio / Network deploy |
| `docs/` | Spec, architecture, sponsor integration references |

## Key API surfaces

| Endpoint | Actor | On-chain effect |
| -------- | ----- | --------------- |
| `POST /api/agent/chat` | Agent operator | Escrow writes via LLM tool calling |
| `GET /api/agent/wallet` | Agent operator | Agent wallet address, USDC balance, funding hint |
| `POST /api/agent/tasks` | Agent | `postTask` (+ USDC approve; blocked if agent wallet underfunded) |
| `POST /api/tasks/:id/bids` | Worker | `placeBid` via relayer + Selfie Check |
| `POST /api/tasks/:id/select` | Agent | `selectWinner` |
| `POST /api/tasks/:id/submit` | Worker | `submitWork(proofHash)` via relayer → triggers proof review |
| `POST /api/worker/change-payout-wallet` | Worker | Updates payout address (Selfie Check + new wallet sign) |
| `POST /api/tasks/:id/reclaim` | Agent | `reclaimTask` |
| `POST /api/tasks/:id/cancel` | Agent | `cancelTask` or `abortTask` |
| `POST /api/wallet/challenge` | Worker | Issues off-chain ownership message |
| `POST /api/wallet/link` | Worker | Stores payout address until first bid |
| `GET /api/workers/:address/balance` | Worker | Read USDC balance on Arc |

Every escrow write goes through `backend/src/agent/operations.ts` so task-state guards live in one place.

Escrow writes return a **pending handle** (`GET /api/transactions/:id`); treat success as confirmed only when the matching subgraph event is indexed.

**Custody:** Circle holds keys for **agent** and **relayer** only. Workers hold their own keys; a leaked backend credential cannot move worker earnings.

## Agent automation

| Loop | Default | Behavior |
| ---- | ------- | -------- |
| Winner selection | **On** (`AGENT_WINNER_LOOP`) | Every 30s after bid deadline, pick winner |
| Proof review | **On submit** | LLM eval + approve/reject when worker submits proof |
| Full agent cycle | Manual | `POST /api/agent/run-once` or agent chat |

## Deployed testnet artifacts

- **Contract:** `0xc8F1db364B14D7Aa4ea620bF9f649Ef3D7F14d52`
- **Deploy block:** `61231705`
- **Subgraph id:** `Fnr7E8tC1HbD1bvdAsTXMwe5R5kZdx98pH1bhmcWWGeL` (Graph Network gateway)
- **Explorer:** [testnet.arcscan.app](https://testnet.arcscan.app)
