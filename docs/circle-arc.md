# Circle + Arc — integration reference

All settlement is **USDC on Arc testnet** via Circle **Developer-Controlled Wallets**. The backend holds two wallets only: the **agent** (funds escrow) and the **relayer** (submits worker transactions so workers never need gas).

## What it does here

| Wallet | Role |
| ------ | ---- |
| **Agent wallet** | `postTask`, `selectWinner`, `approveWork`, `rejectWork`, `reclaimTask`, `cancelTask` |
| **Relayer wallet** | `placeBid`, `submitWork` on behalf of workers |

Workers receive USDC directly at their **self-custodied** payout address on `approveWork` → `PaymentReleased`.

## Code files

### Contracts (Arc testnet)

| File | Role |
| ---- | ---- |
| `contracts/src/TaskEscrow.sol` | USDC escrow state machine |
| `contracts/test/TaskEscrow.t.sol` | Forge tests |
| `contracts/script/DeployTaskEscrow.s.sol` | Deploy script |
| `contracts/script/deploy.sh` | Arc deploy wrapper |

### Backend — Circle SDK

| File | Role |
| ---- | ---- |
| `backend/src/circle/client.ts` | `initiateDeveloperControlledWalletsClient` singleton |
| `backend/src/relayer/submit.ts` | `createContractExecutionTransaction`, nonce queue, Circle tx wait |
| `backend/src/relayer/queue.ts` | Per-wallet serialized submission queue |
| `backend/scripts/setup-wallets.ts` | Create wallet set + agent wallet |
| `backend/scripts/setup-relayer-wallet.ts` | Create relayer wallet |
| `backend/scripts/verify-usdc-transfer.ts` | Smoke test USDC move on Arc |

### Backend — chain / RPC

| File | Role |
| ---- | ---- |
| `backend/src/chain/escrow.ts` | viem public client, escrow ABI reads, `fallback()` RPC transport |
| `backend/src/chain/rpc-url.ts` | Default Arc RPC list + `ARC_RPC_URL` override |
| `backend/src/chain/rpc-queue.ts` | Serialized RPC reads |
| `backend/src/chain/task-state.ts` | On-chain task reads + cache |
| `backend/src/chain/task-view.ts` | Merge DB tasks with live RPC state |
| `backend/src/chain/usdc-balance.ts` | ERC-20 USDC balance reads (`0x3600…0000`) |
| `backend/src/chain/agent-wallet.ts` | Agent wallet address resolution, USDC balance check before `postTask` |
| `backend/src/agent/operations.ts` | All agent escrow writes enqueued through Circle |
| `backend/src/routes/tasks.ts` | Worker bid/submit relay paths |
| `backend/src/proof/submit-work.ts` | `submitWork` relay after proof upload |

### Frontend — Arc / wallets

| File | Role |
| ---- | ---- |
| `frontend/lib/wagmi.ts` | RainbowKit + Arc testnet chain config |
| `frontend/lib/arc-rpc.ts` | Frontend RPC fallback (mirrors backend) |
| `frontend/next.config.ts` | Arc RPC env for client bundle |
| `frontend/lib/api.ts` | `fetchWorkerBalance`, bid/submit API calls |
| `frontend/components/PendingTransaction.tsx` | Polls relay tx status |
| `frontend/lib/link-wallet.ts` | Off-chain `personal_sign` wallet ownership (not Circle) |

### Environment

| File | Role |
| ---- | ---- |
| `.env.example` | `CIRCLE_*`, `ESCROW_CONTRACT_ADDRESS`, `ARC_RPC_URL`, deployer keys |

## Key env vars

- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` — SDK auth
- `CIRCLE_WALLET_SET_ID`, `CIRCLE_AGENT_WALLET_ID`, `CIRCLE_RELAYER_WALLET_ID`
- `ESCROW_CONTRACT_ADDRESS`, `ESCROW_DEPLOY_BLOCK`
- `ARC_RPC_URL` — optional comma-separated RPC list

## Arc facts (this repo)

- Chain ID `5042002`, RPC `https://rpc.testnet.arc.io`
- USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals for escrow amounts)
- Native gas also USDC (18 decimals) — do not mix raw values

See [`AGENTS.md`](../AGENTS.md) for pinned SDK versions and nonce-queue rules.
