import { fetchMedianPaidAmount, fetchMedianSubmissionWindow } from "./queries.js";

const DEFAULT_BUDGET = 1_000_000n;
const DEFAULT_SUBMISSION_WINDOW = 7200n;

export interface AgentTaskParams {
  maxBudget: bigint;
  submissionWindow: bigint;
  reasoning: {
    medianPaidAmount: string | null;
    medianSubmissionWindow: string | null;
    usedDefaults: boolean;
  };
}

export async function deriveTaskParams(): Promise<AgentTaskParams> {
  const [medianPaid, medianWindow] = await Promise.all([
    fetchMedianPaidAmount(),
    fetchMedianSubmissionWindow(),
  ]);

  const usedDefaults = medianPaid === null && medianWindow === null;
  return {
    maxBudget: medianPaid ?? DEFAULT_BUDGET,
    submissionWindow: medianWindow ?? DEFAULT_SUBMISSION_WINDOW,
    reasoning: {
      medianPaidAmount: medianPaid?.toString() ?? null,
      medianSubmissionWindow: medianWindow?.toString() ?? null,
      usedDefaults,
    },
  };
}
