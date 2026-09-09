# Levantate Bridge

An agent-to-human task marketplace with verified workers and on-chain settlement.

When an AI agent hits a task it can't complete alone, it posts it to a marketplace where verified humans bid to do it — and get paid in USDC on Arc the moment the work is approved.

- Architecture and sponsor labels: [`docs/architecture.md`](docs/architecture.md)
- Full product spec: [`docs/spec.md`](docs/spec.md)
- Build checklist: [`PLAN.md`](PLAN.md)
- Operational rules: [`AGENTS.md`](AGENTS.md)

## Sponsor products (observable in the demo)

| Sponsor | What you will see working |
| -------- | ------------------------- |
| **Circle** | Agent and relayer **Developer-Controlled Wallets** on Arc; escrow funded in USDC; autonomous `approveWork` payout to the worker's own address; workers never hold gas. |
| **World ID** | **Selfie Check** (sandbox) on **every bid**, signal-bound to task/round/amount and spendable once; identity derived from the proof, not from the client; nullifier bound one-to-one to a self-custodied payout address. |
| **The Graph** | Subgraph indexes all escrow events; agent sets budget and scores bids from **live** history; backend confirms relayed txs only after indexed events. |

## Prerequisites

- **Node.js** ≥ 22 (required by `@supabase/supabase-js` 2.115)
- **Foundry** v1.8.x (`foundryup`)
- A browser wallet (MetaMask or any EIP-1193 wallet) for the worker flow
- Accounts / keys (see [Environment](#environment)):
  - Circle developer API key + entity secret
  - Supabase project URL + service role key
  - World ID app with RP signing key (Selfie Check Beta access for production preset)
  - The Graph Studio deploy key
  - `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for proof evaluation
- **Sandbox World App** on a physical device (TestFlight / Play private track) for Selfie Check

## Environment

Copy the template and fill in secrets at the **repo root** (never commit `.env.local`):

```bash
cp .env.example .env.local
```

All packages read from this single file. Required keys are listed in [`AGENTS.md`](AGENTS.md) and [`.env.example`](.env.example). After deploying the escrow contract, set:

- `ESCROW_CONTRACT_ADDRESS`
- `ESCROW_DEPLOY_BLOCK`
- `SUBGRAPH_QUERY_URL`

## Quick start

### 1. Contracts (optional — already deployed on Arc testnet)

```bash
cd contracts
forge install
forge test
# Deploy (needs DEPLOYER_PRIVATE_KEY funded on Arc):
./script/deploy.sh
```

Deploy writes address and block to `.env.local` and `contracts/deployments/arc-testnet.json`.

### 2. Database (Supabase)

Create a project at [supabase.com](https://supabase.com), then run [`backend/supabase/schema.sql`](backend/supabase/schema.sql) in the SQL editor. Copy the project URL and the **service role** key into `.env.local` as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

RLS is enabled with no policies, so only the service role (the backend) can read or write.

If you are upgrading from the old JSON file store, import it once with `npm run migrate-db-json` from `backend/`.

### 3. Backend

```bash
cd backend
npm install
npm run dev
```

Listens on `http://localhost:3001`. Starts the agent loop (every 30s) and the subgraph confirmation reconciler.

Health check: `GET http://localhost:3001/health`

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Workers link a payout wallet at `/verify`, then browse tasks at `/tasks`. Selfie Check runs when they bid.

### 5. Subgraph (optional — already deployed)

```bash
cd subgraph
npm install
npm run codegen
graph auth <GRAPH_AUTH_DEPLOY_KEY>
npm run deploy
```

Update `SUBGRAPH_QUERY_URL` in `.env.local` after deploy.

## Demo flow (single worker)

1. **Post a task** — `POST /api/agent/tasks` with a description (defaults: 1h bid window, subgraph-derived budget):

   ```bash
   curl -s -X POST http://localhost:3001/api/agent/tasks \
     -H 'content-type: application/json' \
     -d '{"description":"Collect and summarize complaints from residents in this neighborhood."}'
   ```

2. **Worker links a payout wallet** — open `/verify`, connect a wallet and sign the ownership challenge. This does not authorize bidding.

3. **Worker bids** — on `/tasks/[id]`, enter an amount ≤ max budget, then pass a **fresh Selfie Check** for that exact bid. The first successful bid binds the World ID nullifier to the wallet. Poll pending tx until confirmed.

4. **Agent selects winner** — after `bidDeadline`, the agent loop scores bids (or call `POST /api/agent/run-once`). Selection uses subgraph history.

5. **Worker submits proof** — free text + optional link; only `keccak256` hash goes on-chain.

6. **Agent evaluates proof** — LLM approves or rejects; on approve, USDC moves to the worker's own wallet and unspent budget refunds to the agent.

Poll any write via `GET /api/transactions/:id` — **confirmed** only when the subgraph indexes the expected event.

### Other paths

| Action | How |
| ------ | --- |
| Reject resubmit | Submit weak proof → agent rejects → worker resubmits before deadline |
| Reclaim missed deadline | `POST /api/tasks/:id/reclaim` with `{ "newBidDeadlineSeconds": 3600 }` |
| Cancel open task | `POST /api/tasks/:id/cancel` (`abortTask` if bids exist) |

The agent loop does **not** auto-reclaim or auto-post tasks. Reclaim and new tasks require explicit API calls.

## Useful API routes

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/tasks` | List tasks with on-chain state |
| POST | `/api/tasks/:id/bids` | Place bid — requires a fresh Selfie Check proof |
| POST | `/api/tasks/:id/submit` | Submit proof |
| GET | `/api/transactions/:id` | Relayed tx status |
| GET | `/api/agent/budget` | Subgraph-derived budget params |
| POST | `/api/agent/run-once` | Run one agent cycle |
| POST | `/api/wallet/challenge` | Issue the wallet-ownership message to sign |
| POST | `/api/wallet/link` | Confirm the signature and remember the payout address |
| GET | `/api/workers/:address/balance` | Worker USDC balance on Arc |

## Scripts

| Package | Command | Purpose |
| ------- | ------- | ------- |
| `backend` | `npm run setup-wallets` | Create Circle wallet set + agent wallet |
| `backend` | `npm run setup-relayer-wallet` | Create and register relayer wallet |
| `backend` | `npm run migrate-db-json` | One-shot import of the legacy JSON store into Supabase |
| `backend` | `npm run reconcile` | One-shot confirmation reconciler pass |
| `contracts` | `forge test` | Escrow unit tests |
| `subgraph` | `npm run build` | Compile mappings |

## Testnet details

- **Chain:** Arc testnet (`5042002`) — RPC `https://rpc.testnet.arc.io`
- **USDC (ERC-20):** `0x3600000000000000000000000000000000000000` (6 decimals)
- **Faucet:** [faucet.circle.com](https://faucet.circle.com) (10 USDC/hr)
- **Explorer:** [testnet.arcscan.app](https://testnet.arcscan.app)

## Worker wallets are self-custodied

Workers keep their own keys. At `/verify` a worker connects an existing wallet and signs a single off-chain challenge — free, moves nothing, authorizes no transaction. The first Selfie Check bid binds that address one-to-one with the World ID nullifier, and `approveWork` pays it directly.

There is deliberately **no** withdraw endpoint: the worker already owns the wallet, so there is nothing to withdraw from. `/wallet` shows the balance, an explorer link, and an "add Arc testnet" action so the funds are usable immediately.

Workers still never pay gas. The relayer's Circle wallet submits `placeBid` and `submitWork` on their behalf.

## Security — where are the keys?

Circle Developer-Controlled Wallets keep key material in Circle's infrastructure, not in this repo. What lives in `.env.local` is the credentials that control those wallets:

| Secret | If compromised |
| ------ | -------------- |
| `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` | Attacker controls the **agent and relayer** wallets — can drain the escrow float and disrupt the marketplace. **Cannot touch worker earnings.** |
| Circle entity secret recovery file (kept outside the repo) | Same as above — rotate the entity secret immediately. |
| `SUPABASE_SERVICE_ROLE_KEY` | Full read/write on backend state. No key material, no ability to move funds. |
| `DEPLOYER_PRIVATE_KEY` | Deploy scripts only, not used at runtime. |
| `WORLD_SIGNING_KEY` | Forged RP signatures — not wallet access. |
| Worker `nullifierHash` in browser `localStorage` | Display only. It no longer authorizes a bid — bidding needs a live Selfie Check — though it can still submit work for an already-assigned task. Not a private key, and cannot move funds. |

The blast radius is bounded on purpose: **no single backend credential can move a worker's earnings.** A production deployment would add worker auth, rate limits, and Circle IP allowlists on top. Never commit `.env.local` or print secrets to logs.

## Verified end-to-end (testnet)

With one sandbox World ID identity:

- Task post → bid → subgraph-informed winner selection → proof submit → LLM approve → USDC payout + refund
- Reject path: inadequate proof rejected, resubmit, paid
- Reclaim path: missed deadline indexed as `MissedDeadline`; barred worker cannot re-bid same task
- Duplicate same-amount bid blocked; duplicate nullifier blocked at API
- All relayed transactions confirmed via subgraph, not hash alone

Those runs predate three changes that still need a re-verification pass: self-custodied worker wallets, Supabase persistence, and per-bid Selfie Check. See `PLAN.md`. A second World ID identity for competing bids and round-2 reclaim payout is also deferred.

## Docs

- [`docs/selfie-check-feedback.md`](docs/selfie-check-feedback.md) — integration notes and friction log
- [`docs/architecture.md`](docs/architecture.md) — diagram and sponsor mapping
