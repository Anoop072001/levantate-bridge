# Circle + Arc — integration reference

All settlement is **USDC on Arc testnet** via Circle **Developer-Controlled Wallets**. The backend holds two wallets only: the **agent** (funds escrow) and the **relayer** (submits worker transactions so workers never need gas).

**Start here if you are reviewing Circle / Arc integration.**

## What it does here

| Wallet | Role | On-chain calls |
| ------ | ---- | -------------- |
| **Agent wallet** | Funds escrow, settles tasks | `postTask`, `selectWinner`, `approveWork`, `rejectWork`, `reclaimTask`, `cancelTask` / `abortTask`, USDC `approve` |
| **Relayer wallet** | Gasless worker writes | `placeBid`, `submitWork` |

Workers receive USDC directly at their **self-custodied** payout address on `approveWork` → `PaymentReleased`.

**Write confirmation:** Circle returns a tx hash → backend waits for an **Arc RPC receipt** (`status = success` → confirmed, revert → failed). See `backend/src/chain/wait-receipt.ts`.

## Code map (by layer)

### Circle SDK client

`backend/src/circle/client.ts` — singleton Developer-Controlled Wallets client:

```typescript
export function createCircleClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: requireEnv("CIRCLE_API_KEY"),
    entitySecret: requireEnv("CIRCLE_ENTITY_SECRET"),
  });
}
```

Wallet setup scripts: `backend/scripts/setup-wallets.ts`, `backend/scripts/setup-relayer-wallet.ts`.

### Contract execution + receipt wait

`backend/src/relayer/submit.ts` — every on-chain write goes through Circle, then Arc RPC:

```typescript
response = await client.createContractExecutionTransaction({
  walletId: input.walletId,
  contractAddress: input.contractAddress,
  abiFunctionSignature: input.abiFunctionSignature,
  abiParameters: input.abiParameters,
  idempotencyKey,
  fee: { type: "level", config: { feeLevel: "LOW" } },
});
// … wait for Circle hash, then:
const outcome = await waitForArcReceipt(txHash);
```

Serialized nonces per wallet: `backend/src/relayer/queue.ts` (`enqueueContractCall`).

Arc receipt helper:

```typescript
// backend/src/chain/wait-receipt.ts
export async function waitForArcReceipt(txHash: string): Promise<"confirmed" | "failed"> {
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    timeout: RECEIPT_TIMEOUT_MS,
    confirmations: 1,
  });
  return receipt.status === "success" ? "confirmed" : "failed";
}
```

Startup recovery for stuck rows: `backend/src/relayer/reconcile.ts`.

### Agent escrow writes (Circle agent wallet)

`backend/src/agent/operations.ts` — post task, select winner, approve/reject, reclaim, cancel:

```typescript
const postTx = await enqueueContractCall({
  walletId: agentWalletId,
  kind: "post_task",
  expectedEvent: "TaskPosted",
  contractAddress: escrowAddress,
  abiFunctionSignature: "postTask(string,uint256,uint256,uint256)",
  abiParameters: [description, maxBudget.toString(), bidDeadline.toString(), submissionWindow.toString()],
  taskId,
  round: 0,
});
```

Funding check before post: `backend/src/chain/agent-wallet.ts` (`checkAgentFunding`).

### Worker relay writes (Circle relayer wallet)

Bid relay — `backend/src/routes/tasks.ts`:

```typescript
const tx = await enqueueContractCall({
  walletId: relayerWalletId,
  kind: "place_bid",
  expectedEvent: "BidPlaced",
  contractAddress: escrowAddress,
  abiFunctionSignature: "placeBid(uint256,address,uint256)",
  abiParameters: [taskId, worker.address, BigInt(input.amount).toString()],
  taskId,
  round: onChain.round,
  worker: worker.address,
});
```

Work submission relay: `backend/src/proof/submit-work.ts` → `submitWork(uint256,bytes32)`.

### Escrow contract (Arc testnet)

| File | Role |
| ---- | ---- |
| `contracts/src/TaskEscrow.sol` | USDC escrow state machine, all eight events |
| `contracts/test/TaskEscrow.t.sol` | Forge tests |
| `contracts/script/DeployTaskEscrow.s.sol` | Deploy script |
| `contracts/script/deploy.sh` | Arc deploy wrapper |
| `contracts/deployments/arc-testnet.json` | Deployed address + block |

### Chain reads (viem + Arc RPC)

| File | Role |
| ---- | ---- |
| `backend/src/chain/escrow.ts` | Public client, escrow ABI reads, fallback RPC transport |
| `backend/src/chain/rpc-url.ts` | Default Arc RPC list + `ARC_RPC_URL` override |
| `backend/src/chain/task-state.ts` | On-chain task reads + cache invalidation |
| `backend/src/chain/task-view.ts` | Merge Supabase tasks with live RPC state |
| `backend/src/chain/usdc-balance.ts` | ERC-20 USDC balance (`0x3600…0000`, 6 decimals) |

### Frontend (Arc + balance display)

| File | Role |
| ---- | ---- |
| `frontend/lib/wagmi.ts` | RainbowKit + `arcTestnet` chain |
| `frontend/lib/arc-rpc.ts` | Client RPC fallback |
| `frontend/lib/api.ts` | `fetchWorkerBalance`, bid/submit API |
| `frontend/components/PendingTransaction.tsx` | Polls `GET /api/transactions/:id` until confirmed/failed |

Workers connect their **own** wallet (not Circle): `frontend/lib/link-wallet.ts`, `frontend/components/LinkWalletButton.tsx`.

## Key env vars

- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` — SDK auth
- `CIRCLE_WALLET_SET_ID`, `CIRCLE_AGENT_WALLET_ID`, `CIRCLE_RELAYER_WALLET_ID`
- `ESCROW_CONTRACT_ADDRESS`, `ESCROW_DEPLOY_BLOCK`
- `ARC_RPC_URL` — optional comma-separated RPC list

## Arc facts (this repo)

- Chain ID `5042002`, RPC `https://rpc.testnet.arc.io`
- USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals for escrow amounts)
- Native gas also USDC (18 decimals) — do not mix raw values
- Explorer: [testnet.arcscan.app](https://testnet.arcscan.app)

### Deployed addresses (this demo)

| Role | Address |
| ---- | ------- |
| **TaskEscrow** | `0xc8F1db364B14D7Aa4ea620bF9f649Ef3D7F14d52` |
| **Agent wallet** | `0x42472b448b6ba8bb654483d4773db715901a64a7` |
| **Relayer wallet** | `0xd055b6cee7d72bc5111119ec7beb8c56b2f61ae1` |

Deploy block `61231705`. See [`contracts/deployments/arc-testnet.json`](../contracts/deployments/arc-testnet.json) and the README testnet table for Arcscan links.

See [`AGENTS.md`](../AGENTS.md) for pinned SDK versions and nonce-queue rules.
