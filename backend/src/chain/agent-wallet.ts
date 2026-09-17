import { isAddress } from "viem";
import { readUsdcBalance } from "./usdc-balance.js";

export const ARC_USDC_FAUCET_URL = "https://faucet.circle.com";

export interface AgentFundingHint {
  agent_address: string;
  balance_usdc: number;
  required_usdc: number;
  faucet_url: string;
}

export interface AgentFundingCheck {
  agentAddress: `0x${string}`;
  balanceMicro: bigint;
  requiredMicro: bigint;
  sufficient: boolean;
  faucetUrl: string;
}

export function usdcMicroToNumber(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

export function fundingHintPayload(check: AgentFundingCheck): AgentFundingHint {
  return {
    agent_address: check.agentAddress,
    balance_usdc: usdcMicroToNumber(check.balanceMicro),
    required_usdc: usdcMicroToNumber(check.requiredMicro),
    faucet_url: check.faucetUrl,
  };
}

export function insufficientFundingMessage(check: AgentFundingCheck): string {
  const have = usdcMicroToNumber(check.balanceMicro);
  const need = usdcMicroToNumber(check.requiredMicro);
  return (
    `Agent wallet needs at least ${need.toFixed(2)} USDC to post this task (current balance: ${have.toFixed(2)} USDC). ` +
    `Fund ${check.agentAddress} at ${check.faucetUrl} — select Arc Testnet — then retry.`
  );
}

export async function readAgentUsdcBalance(
  address: `0x${string}`,
): Promise<{ address: `0x${string}`; balanceMicro: bigint }> {
  if (!isAddress(address)) {
    throw new Error("Invalid agent wallet address");
  }
  const balanceMicro = await readUsdcBalance(address);
  return { address, balanceMicro };
}

/** Returns whether the given agent wallet holds at least `requiredMicro` USDC (6-decimal ERC-20). */
export async function checkAgentFunding(
  requiredMicro: bigint,
  address: `0x${string}`,
): Promise<AgentFundingCheck> {
  const { balanceMicro } = await readAgentUsdcBalance(address);
  return {
    agentAddress: address,
    balanceMicro,
    requiredMicro,
    sufficient: balanceMicro >= requiredMicro,
    faucetUrl: ARC_USDC_FAUCET_URL,
  };
}

export function fundingHintFromPayload(payload: unknown): AgentFundingHint | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as { funding?: AgentFundingHint; sufficient?: boolean };
  const funding = p.funding;
  if (!funding?.agent_address) return undefined;
  if (p.sufficient === true) return undefined;
  if (p.sufficient === false) return funding;
  if (funding.required_usdc > 0 && funding.balance_usdc < funding.required_usdc) {
    return funding;
  }
  return undefined;
}
