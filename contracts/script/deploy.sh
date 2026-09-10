#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -n "${ARC_RPC_URL:-}" ]]; then
  RPC="${ARC_RPC_URL%%,*}"
else
  RPC="https://rpc.testnet.arc.io"
fi

export PATH="${PATH}:${HOME}/.foundry/bin"

cd "$ROOT/contracts"

forge script script/DeployTaskEscrow.s.sol:DeployTaskEscrow \
  --rpc-url "$RPC" \
  --broadcast \
  --slow \
  -vvv

DEPLOY_JSON="$ROOT/contracts/broadcast/DeployTaskEscrow.s.sol/5042002/run-latest.json"
if [[ -f "$DEPLOY_JSON" ]]; then
  ADDR=$(python3 - <<'PY' "$DEPLOY_JSON"
import json, sys
data = json.load(open(sys.argv[1]))
for tx in data.get("transactions", []):
    if tx.get("transactionType") == "CREATE":
        print(tx["contractAddress"])
        break
PY
)
  BLOCK=$(python3 - <<'PY' "$DEPLOY_JSON"
import json, sys
data = json.load(open(sys.argv[1]))
print(data["receipts"][0]["blockNumber"])
PY
)
  python3 - <<PY
from pathlib import Path
p = Path("$ENV_FILE")
lines = []
for ln in p.read_text().splitlines():
    if ln.startswith("ESCROW_CONTRACT_ADDRESS=") or ln.startswith("ESCROW_DEPLOY_BLOCK="):
        continue
    lines.append(ln)
lines.append("ESCROW_CONTRACT_ADDRESS=$ADDR")
lines.append("ESCROW_DEPLOY_BLOCK=$BLOCK")
p.write_text("\n".join(lines) + "\n")
PY
  mkdir -p deployments
  cat > deployments/arc-testnet.json <<EOF
{
  "chainId": 5042002,
  "contractAddress": "$ADDR",
  "deployBlock": $BLOCK,
  "usdc": "0x3600000000000000000000000000000000000000"
}
EOF
  echo "Deployed TaskEscrow at $ADDR (block $BLOCK)"
fi
