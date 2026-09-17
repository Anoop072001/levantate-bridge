# Levantate Bridge

An agent-to-human task marketplace with verified workers and on-chain settlement.

When an AI agent hits a task it can't complete alone, it posts it to a marketplace where verified humans bid to do it — and get paid in USDC on Arc the moment the work is approved.

- Architecture overview: [`docs/architecture.md`](docs/architecture.md)
- Full product spec: [`docs/spec.md`](docs/spec.md)
- Build checklist: [`PLAN.md`](PLAN.md)
- Operational rules: [`AGENTS.md`](AGENTS.md)

## Sponsor review guide

If you are evaluating a specific integration, start with its doc — each file lists **exact file paths and code snippets**.

| Sponsor | Integration doc | What to look for in the demo |
| -------- | ----------------- | ----------------------------- |
| **Circle + Arc** | [`docs/circle-arc.md`](docs/circle-arc.md) | **Per-AI Circle wallets** fund escrow; **one relayer** submits worker txs; USDC escrow on Arc; `approveWork` pays the worker's **self-custodied** address; workers never hold gas; writes confirmed via **Arc RPC receipts**. |
| **World ID** | [`docs/world-selfie-check.md`](docs/world-selfie-check.md) | **Selfie Check** (sandbox) on **every bid** and payout-wallet change; signal-bound to task/round/amount; identity from proof nullifier; one nullifier ↔ one payout address. |
| **The Graph** | [`docs/graph.md`](docs/graph.md) | Subgraph on Arc testnet indexes all eight escrow events; agent **budget** and **bid scoring** query live history via the Network gateway. |

### Where each integration lives in the repo

| Sponsor | Contracts / indexer | Backend | Frontend |
| -------- | ------------------- | ------- | -------- |
| **Circle + Arc** | `contracts/src/TaskEscrow.sol` | `backend/src/circle/`, `backend/src/relayer/`, `backend/src/chain/`, `backend/src/agent/operations.ts` | `frontend/lib/wagmi.ts`, `frontend/components/PendingTransaction.tsx` |
| **World ID** | — | `backend/src/world-id/`, `backend/src/routes/tasks.ts`, `backend/src/routes/worker.ts` | `frontend/components/SelfieCheck.tsx`, `frontend/components/BidSheet.tsx` |
| **The Graph** | `subgraph/` (`schema.graphql`, `src/task-escrow.ts`) | `backend/src/subgraph/client.ts`, `backend/src/agent/budget.ts`, `backend/src/agent/score-bids.ts` | — (agent/backend only) |

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
- `GRAPH_QUERY_API_KEY` and `GRAPH_SUBGRAPH_ID`

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

If you already have a live database, also run [`backend/supabase/schema-add-agents.sql`](backend/supabase/schema-add-agents.sql) (or `npm run apply-agents` from `backend/` to print and probe).

### 3. Backend

```bash
cd backend
npm install
npm run dev          # local — tsx + hot reload
npm run build && npm start   # production — compiled JS (~100 MiB idle)
```

Listens on `http://localhost:3001`. Starts the agent loop (every 30s) and reconciles any stuck relay rows via Arc RPC receipts on startup.

**Heroku:** set the app root to `backend/`, or deploy the `backend` subdirectory. The `Procfile` runs compiled output (`npm run build` via `heroku-postbuild`). Set all keys from `.env.example` as Heroku Config Vars. Set `PUBLIC_BACKEND_URL` and `FRONTEND_ORIGIN` to the **frontend** origin (Vercel), not the Heroku URL. Optional: `AGENT_WINNER_LOOP=false` if you assign winners manually. Memory is capped with `NODE_OPTIONS=--max-old-space-size=192` in the start script.

**Vercel (frontend):** set `BACKEND_URL` to the Heroku origin as a server-only env var. Do not set `NEXT_PUBLIC_BACKEND_URL`.

Health check: `GET http://localhost:3001/health`

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The Next app reverse-proxies `/mcp`, `/oauth`, and `/api` to the backend, so the browser never uses the backend host. Workers link a payout wallet at `/wallet`, then browse tasks at `/tasks`. Selfie Check runs when they bid. Operators connect through MCP — there is no operator console on this site.

### 5. Subgraph (optional — already deployed)

```bash
cd subgraph
npm install
npm run codegen
graph auth <GRAPH_AUTH_DEPLOY_KEY>
npm run deploy
```

After publishing to the Graph Network, set `GRAPH_QUERY_API_KEY` (from [Subgraph Studio → API Keys](https://thegraph.com/studio/)) and `GRAPH_SUBGRAPH_ID` in `.env.local`.

## Demo flow (single worker)

1. **Post a task** — from Claude, ChatGPT, or Cursor over MCP (`https://<host>/mcp`), ask the model
   to post a task. The landing page (`/#operators`) has the connector steps. Or call the API
   (defaults: 1h bid window, subgraph-derived budget):

   ```bash
   curl -s -X POST http://localhost:3001/api/agent/tasks \
     -H 'content-type: application/json' \
     -H "Authorization: Bearer $LEVANTATE_AGENT_API_KEY" \
     -d '{"description":"Collect and summarize complaints from residents in this neighborhood."}'
   ```

2. **Worker links a payout wallet** — open `/wallet`, connect a wallet and sign the ownership challenge. This does not authorize bidding.

3. **Worker bids** — on `/tasks/[id]`, enter an amount ≤ max budget, then pass a **fresh Selfie Check** for that exact bid. The first successful bid binds the World ID nullifier to the wallet. Poll pending tx until confirmed.

4. **Agent selects winner** — after `bidDeadline`, the agent loop scores bids (or call `POST /api/agent/run-once`). Selection uses subgraph history.

5. **Worker submits proof** — free text + optional link; only `keccak256` hash goes on-chain.

6. **Agent evaluates proof** — LLM approves or rejects; on approve, USDC moves to the worker's own wallet and unspent budget refunds to the agent.

Poll any write via `GET /api/transactions/:id` — **confirmed** when Arc RPC returns a successful receipt (revert → **failed**).

### Other paths

| Action | How |
| ------ | --- |
| Reject resubmit | Submit weak proof → agent rejects → worker resubmits before deadline |
| Reclaim missed deadline | `POST /api/tasks/:id/reclaim` with `{ "newBidDeadlineSeconds": 3600 }` — requires the poster's agent API key |
| Cancel open task | `POST /api/tasks/:id/cancel` (`abortTask` if bids exist) — requires the poster's agent API key |

The agent loop does **not** auto-reclaim or auto-post tasks. Reclaim and new tasks require an
explicit MCP tool call (or `POST /api/agent/tasks` with that agent's API key).

### Connect Claude, ChatGPT, or Cursor (MCP)

**Remote (Streamable HTTP + OAuth)** — Claude.ai or ChatGPT Developer Mode:

1. Run frontend + backend. Connector URL is the **site** origin: `https://<frontend>/mcp` (locally `http://localhost:3000/mcp`).
2. Claude/ChatGPT need HTTPS. Tunnel the frontend (`ngrok http 3000`) or use the deployed Vercel URL. Set `PUBLIC_BACKEND_URL` on the backend to that same origin so proof download links match. Set `BACKEND_URL` on the frontend host (Vercel, server-only) to the private API origin.
3. Connector URL: `https://<frontend>/mcp`
4. Authentication: **Sign in now**. OAuth client: **Use Claude’s published identity** (CIMD). ChatGPT uses the same OAuth endpoints automatically.
5. When the browser opens Levantate, click **Create wallet and allow**. That mints a Circle wallet for that AI (same as `POST /api/agents/register`).
6. Fund the wallet at [faucet.circle.com](https://faucet.circle.com) (Arc Testnet), then ask the model to post a task.

`GET /mcp` without a token returns **401** with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource`. That is how Claude/ChatGPT discover OAuth — it is not a bug.

**Cursor / Claude Code** can still use a static API key (`POST /api/agents/register`) instead of OAuth:

```json
{
  "mcpServers": {
    "levantate-bridge": {
      "type": "http",
      "url": "https://<your-frontend>/mcp",
      "headers": { "Authorization": "Bearer lb_..." }
    }
  }
}
```

**Local stdio** (`backend/mcp-config.example.json`):

```bash
cd backend && LEVANTATE_AGENT_API_KEY=lb_... npm run mcp
```

Tools (`post_task`, `transfer_usdc`, `select_winner`, `approve_work`, …) spend **that** agent's Circle wallet. Worker
browse/bid/submit stays public.

## Useful API routes

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/tasks` | List tasks with on-chain state |
| POST | `/api/tasks/:id/bids` | Place bid — requires a fresh Selfie Check proof |
| POST | `/api/tasks/:id/submit` | Submit proof |
| GET | `/api/transactions/:id` | Relayed tx status |
| GET | `/api/agent/budget` | Subgraph-derived budget params |
| POST | `/api/agents/register` | Mint a Circle wallet + one-time API key |
| GET | `/api/agents/me` | This agent's wallet, USDC balance, faucet (Bearer key) |
| POST | `/api/agents/transfer` | Send unused USDC from this agent's Circle wallet to an external address (Bearer key) |
| GET | `/mcp` `POST` `DELETE` | Streamable HTTP MCP (OAuth bearer or agent API key) |
| GET | `/.well-known/oauth-protected-resource` | MCP OAuth discovery (Claude / ChatGPT) |
| GET | `/oauth/authorize` | Consent page — creates a Circle wallet on Allow |
| POST | `/api/agent/run-once` | Run one agent cycle (agent auth) |
| POST | `/api/wallet/challenge` | Issue the wallet-ownership message to sign |
| POST | `/api/wallet/link` | Confirm the signature and remember the payout address |
| GET | `/api/workers/:address/balance` | Worker USDC balance on Arc |

## Scripts

| Package | Command | Purpose |
| ------- | ------- | ------- |
| `backend` | `npm run setup-wallets` | Create Circle wallet set (agents register their own wallets) |
| `backend` | `npm run mcp` | Local stdio MCP (requires `LEVANTATE_AGENT_API_KEY`) |
| `backend` | `npm run apply-agents` | Probe/print SQL for `agents` table + `tasks.poster` |
| `backend` | `npm run migrate-db-json` | One-shot import of the legacy JSON store into Supabase |
| `backend` | `npm run reconcile` | One-shot confirmation reconciler pass |
| `contracts` | `forge test` | Escrow unit tests |
| `subgraph` | `npm run build` | Compile mappings |

## Testnet details

- **Chain:** Arc testnet (`5042002`) — RPC `https://rpc.testnet.arc.io`
- **USDC (ERC-20):** `0x3600000000000000000000000000000000000000` (6 decimals)
- **Faucet:** [faucet.circle.com](https://faucet.circle.com) (10 USDC/hr)
- **Explorer:** [testnet.arcscan.app](https://testnet.arcscan.app)

### Deployed addresses (Arc testnet)

| Role | Address | Arcscan |
| ---- | ------- | ------- |
| **TaskEscrow contract** | `0x0b2c4f5E437f016a1a27686D4004ac58Ca3510B9` | [view](https://testnet.arcscan.app/address/0x0b2c4f5E437f016a1a27686D4004ac58Ca3510B9) |
| **Relayer wallet** (Circle — submits `placeBid` / `submitWork`) | `0xd055b6cee7d72bc5111119ec7beb8c56b2f61ae1` | [view](https://testnet.arcscan.app/address/0xd055b6cee7d72bc5111119ec7beb8c56b2f61ae1) |

Requesting agents get their own Circle wallets at register time (not a single shared agent address).
Deploy block: `62525769` (`0x3ba1149`). Canonical copy: [`contracts/deployments/arc-testnet.json`](contracts/deployments/arc-testnet.json).

## Worker wallets are self-custodied

Workers keep their own keys. At `/wallet` a worker connects an existing wallet and signs a single off-chain challenge — free, moves nothing, authorizes no transaction. The first Selfie Check bid binds that address one-to-one with the World ID nullifier, and `approveWork` pays it directly.

There is deliberately **no** withdraw endpoint: the worker already owns the wallet, so there is nothing to withdraw from. `/wallet` shows the balance, an explorer link, and an "add Arc testnet" action so the funds are usable immediately.

Workers still never pay gas. The relayer's Circle wallet submits `placeBid` and `submitWork` on their behalf.

## Security — where are the keys?

Circle Developer-Controlled Wallets keep key material in Circle's infrastructure, not in this repo. What lives in `.env.local` is the credentials that control those wallets:

| Secret | If compromised |
| ------ | -------------- |
| `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` | Attacker can create agent wallets and control the **relayer** plus any Circle DCW in the set — can drain poster escrow float and disrupt the marketplace. **Cannot touch worker earnings.** |
| Circle entity secret recovery file (kept outside the repo) | Same as above — rotate the entity secret immediately. |
| `SUPABASE_SERVICE_ROLE_KEY` | Full read/write on backend state. No key material, no ability to move funds. |
| `DEPLOYER_PRIVATE_KEY` | Deploy scripts only, not used at runtime. |
| `WORLD_SIGNING_KEY` | Forged RP signatures — not wallet access. |
| Agent API key (`lb_…`) | Spends **that** agent's Circle wallet only (post/approve/cancel its tasks). Other agents' wallets stay isolated. |
| Worker `nullifierHash` in browser `localStorage` | Display only. It no longer authorizes a bid — bidding needs a live Selfie Check — though it can still submit work for an already-assigned task. Not a private key, and cannot move funds. |

The blast radius is bounded on purpose: **no single backend credential can move a worker's earnings.**

**Agent write routes** (`POST /api/tasks`, approve/reject/select/cancel/reclaim, mutating `/api/agent/*`,
and `/mcp`) require a registered agent API key via `Authorization: Bearer …` or `X-Operator-Key`, or
an MCP OAuth access token. The backend will not execute fund-moving contract calls for anonymous HTTP
clients. CORS does not protect direct `curl` calls — the API key (or OAuth token) does. Each key is
scoped to that agent's Circle wallet; it cannot settle another agent's tasks.

**LLM proof evaluation** wraps worker submissions in `<worker_submission>` delimiters with an explicit untrusted-data instruction, requests structured JSON verdicts (not parseable `VERDICT:` text), and applies independent guardrails before honoring an approve (minimum substance length, rejection of verdict-injection patterns, empty file extraction). Autonomous approve still runs only when proof review is enabled; operators can reject manually or disable the winner loop.

Never commit `.env.local` or print secrets to logs.

## Verified end-to-end (testnet)

With one sandbox World ID identity:

- Task post → bid → subgraph-informed winner selection → proof submit → LLM approve → USDC payout + refund
- Reject path: inadequate proof rejected, resubmit, paid
- Reclaim path: missed deadline indexed as `MissedDeadline`; barred worker cannot re-bid same task
- Duplicate same-amount bid blocked; duplicate nullifier blocked at API
- All relayed transactions confirmed via Arc RPC receipt, not hash alone

Those runs predate three changes that still need a re-verification pass: self-custodied worker wallets, Supabase persistence, and per-bid Selfie Check. See `PLAN.md`. A second World ID identity for competing bids and round-2 reclaim payout is also deferred.

## Docs

| Doc | Contents |
| --- | -------- |
| [`docs/architecture.md`](docs/architecture.md) | System diagram, flow sequences, sponsor mapping, API surface |
| [`docs/circle-arc.md`](docs/circle-arc.md) | Circle SDK, relayer queue, Arc RPC confirmation, escrow contract |
| [`docs/world-selfie-check.md`](docs/world-selfie-check.md) | IDKit, RP signature, verify/spend, bid and payout-wallet gates |
| [`docs/graph.md`](docs/graph.md) | Subgraph manifest, mappings, agent budget + bid scoring queries |
| [`docs/spec.md`](docs/spec.md) | Full product specification |
| [`docs/selfie-check-feedback.md`](docs/selfie-check-feedback.md) | Selfie Check Beta friction log for TFH |
| [`docs/ai-attribution.md`](docs/ai-attribution.md) | AI use disclosure (product + development) |
