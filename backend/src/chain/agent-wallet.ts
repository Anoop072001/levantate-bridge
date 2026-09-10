import { isAddress } from "viem";
import { createCircleClient } from "../circle/client.js";
import { requireEnv } from "../env.js";
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

export async function resolveAgentWalletAddress(): Promise<`0x${string}`> {
  for (const candidate of [
    process.env.CIRCLE_AGENT_WALLET_ADDRESS,
    process.env.DEPLOYER_AGENT_ADDRESS,
  ]) {
    const trimmed = candidate?.trim();
    if (trimmed && isAddress(trimmed)) {
      return trimmed as `0x${string}`;
    }
  }

  const walletId = requireEnv("CIRCLE_AGENT_WALLET_ID");
  const client = createCircleClient();
  const res = await client.getWallet({ id: walletId });
  const address = res.data?.wallet?.address;
  if (!address || !isAddress(address)) {
    throw new Error(
      "Could not resolve agent wallet address — set CIRCLE_AGENT_WALLET_ADDRESS in .env.local",
    );
  }
  return address as `0x${string}`;
}

export async function readAgentUsdcBalance(): Promise<{ address: `0x${string}`; balanceMicro: bigint }> {
  const address = await resolveAgentWalletAddress();
  const balanceMicro = await readUsdcBalance(address);
  return { address, balanceMicro };
}

/** Returns whether the agent wallet holds at least `requiredMicro` USDC (6-decimal ERC-20). */
export async function checkAgentFunding(requiredMicro: bigint): Promise<AgentFundingCheck> {
  const { address, balanceMicro } = await readAgentUsdcBalance();
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
  const funding = (payload as { funding?: AgentFundingHint }).funding;
  if (!funding?.agent_address) return undefined;
  return funding;
}
