import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Ban,
  ClipboardList,
  Coins,
  Download,
  FileSearch,
  LayoutList,
  Megaphone,
  Receipt,
  RotateCcw,
  Scale,
  ScanSearch,
  Sparkles,
  Trophy,
  Wallet,
  Wrench,
} from "lucide-react";

const TOOL_CATEGORY: Record<string, string> = {
  list_tasks: "marketplace",
  get_task: "marketplace",
  score_bids: "marketplace",
  post_task: "escrow",
  select_winner: "escrow",
  approve_work: "escrow",
  reject_work: "escrow",
  reclaim_task: "escrow",
  cancel_task: "escrow",
  evaluate_proof: "llm",
  get_proof_download: "marketplace",
  get_agent_wallet: "wallet",
  get_transaction: "escrow",
};

const TOOL_ICON: Record<string, LucideIcon> = {
  list_tasks: LayoutList,
  get_task: FileSearch,
  score_bids: Scale,
  post_task: Megaphone,
  select_winner: Trophy,
  approve_work: BadgeCheck,
  reject_work: Ban,
  reclaim_task: RotateCcw,
  cancel_task: Ban,
  evaluate_proof: Sparkles,
  get_proof_download: Download,
  get_agent_wallet: Wallet,
  get_transaction: Receipt,
};

const CATEGORY_ICON: Record<string, LucideIcon> = {
  marketplace: ClipboardList,
  escrow: Coins,
  wallet: Wallet,
  llm: ScanSearch,
  general: Wrench,
};

export function toolCategoryFor(toolName: string): string {
  return TOOL_CATEGORY[toolName] ?? "general";
}

export function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

function resolveIcon(toolName?: string, category?: string): LucideIcon {
  if (toolName && TOOL_ICON[toolName]) return TOOL_ICON[toolName]!;
  const cat = category || "general";
  return CATEGORY_ICON[cat] ?? Wrench;
}

export function getToolCategoryIcon(
  category: string,
  size: { width: number; height: number },
  _iconUrl?: string,
  toolName?: string,
) {
  const Icon = resolveIcon(toolName, category);
  const px = Math.max(14, Math.round(size.width * 0.62));

  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white shadow-sm ring-1 ring-black/[0.04]">
      <Icon size={px} strokeWidth={2.25} className="text-black" />
    </div>
  );
}
