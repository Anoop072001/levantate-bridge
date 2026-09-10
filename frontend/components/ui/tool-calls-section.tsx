"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { CompactMarkdown } from "@/components/ui/tool-calls-section-utils/compact-markdown";
import {
  formatToolName,
  getToolCategoryIcon,
} from "@/components/ui/tool-calls-section-utils/tool-icons";

export interface ToolCallEntry {
  tool_name: string;
  tool_category: string;
  message?: string;
  show_category?: boolean;
  tool_call_id?: string;
  inputs?: Record<string, unknown>;
  output?: string;
  icon_url?: string;
  integration_name?: string;
}

export interface IntegrationInfo {
  iconUrl?: string;
  name?: string;
}

export interface ToolCallsSectionProps {
  toolCalls: ToolCallEntry[];
  integrations?: Map<string, IntegrationInfo>;
  maxIconsToShow?: number;
  defaultExpanded?: boolean;
  className?: string;
  iconSize?: number;
  renderIcon?: (call: ToolCallEntry, size: number) => ReactNode;
  renderContent?: (content: unknown) => ReactNode;
}

function ChevronIcon({
  isExpanded,
  size = 18,
  className = "",
}: {
  isExpanded: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <ChevronDown
      size={size}
      className={cn(
        "transition-transform duration-200",
        isExpanded && "rotate-180",
        className,
      )}
    />
  );
}

export function ToolCallsSection({
  toolCalls,
  integrations,
  maxIconsToShow = 10,
  defaultExpanded = false,
  className,
  iconSize = 21,
  renderIcon,
  renderContent,
}: ToolCallsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [expandedCalls, setExpandedCalls] = useState<Set<number>>(new Set());

  const integrationLookup = useMemo(() => {
    if (integrations) return integrations;
    return new Map<string, IntegrationInfo>();
  }, [integrations]);

  const getIconUrl = (call: ToolCallEntry): string | undefined => {
    if (call.icon_url) return call.icon_url;
    return integrationLookup.get(call.tool_category)?.iconUrl;
  };

  const getIntegrationName = (call: ToolCallEntry): string | undefined => {
    if (call.integration_name) return call.integration_name;
    return integrationLookup.get(call.tool_category)?.name;
  };

  const toggleCallExpansion = (index: number) => {
    setExpandedCalls((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (toolCalls.length === 0) return null;

  const defaultRenderIcon = (call: ToolCallEntry, size: number) =>
    getToolCategoryIcon(
      call.tool_category || "general",
      { width: size, height: size },
      getIconUrl(call),
      call.tool_name,
    ) ?? (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white shadow-sm">
        <Wrench size={Math.round(size * 0.62)} strokeWidth={2.25} className="text-black" />
      </div>
    );

  const iconRenderer = renderIcon || defaultRenderIcon;
  const contentRenderer = renderContent || ((content: unknown) => <CompactMarkdown content={content} />);

  const renderStackedIcons = () => {
    const seenCategories = new Set<string>();
    const uniqueIcons = toolCalls.filter((call) => {
      const key = call.tool_name || call.tool_category || "general";
      if (seenCategories.has(key)) return false;
      seenCategories.add(key);
      return true;
    });
    const displayIcons = uniqueIcons.slice(0, maxIconsToShow);

    return (
      <div className="flex min-h-8 items-center -space-x-2">
        {displayIcons.map((call, index) => (
          <div
            key={`${call.tool_name}-${index}`}
            className="relative flex min-w-8 items-center justify-center"
            style={{
              rotate:
                displayIcons.length > 1 ? (index % 2 === 0 ? "8deg" : "-8deg") : "0deg",
              zIndex: index,
            }}
          >
            {iconRenderer(call, iconSize)}
          </div>
        ))}
        {uniqueIcons.length > maxIconsToShow && (
          <div className="z-0 flex size-7 min-h-7 min-w-7 items-center justify-center rounded-lg bg-zinc-200 text-xs font-normal text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-500">
            +{uniqueIcons.length - maxIconsToShow}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("w-fit max-w-[35rem]", className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="group/header flex cursor-pointer items-center gap-2 py-2 text-zinc-500 hover:text-black"
      >
        {renderStackedIcons()}
        <span className="text-xs font-medium transition-colors duration-200 group-hover/header:text-black">
          Used {toolCalls.length} tool{toolCalls.length > 1 ? "s" : ""}
        </span>
        <ChevronIcon
          isExpanded={isExpanded}
          className="transition-colors group-hover/header:text-black"
        />
      </button>

      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="space-y-0 pt-1">
          {toolCalls.map((call, index) => {
            const hasCategoryText =
              call.show_category !== false &&
              call.tool_category &&
              call.tool_category !== "unknown";
            const hasDetails = call.inputs || call.output;
            const isCallExpanded = expandedCalls.has(index);

            return (
              <div key={`${call.tool_name}-step-${index}`} className="flex items-stretch gap-2">
                <div className="flex flex-col items-center self-stretch">
                  <div className="flex min-h-8 min-w-8 shrink-0 items-center justify-center">
                    {iconRenderer(call, iconSize)}
                  </div>
                  {index < toolCalls.length - 1 && (
                    <div className="min-h-4 w-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className={cn(
                      "group/parent flex items-center gap-1",
                      hasDetails ? "cursor-pointer" : "",
                      !hasCategoryText ? "pt-2" : "",
                    )}
                    onClick={() => hasDetails && toggleCallExpansion(index)}
                  >
                    <p
                      className={cn(
                        "text-xs font-medium text-zinc-600 transition-colors",
                        hasDetails && "group-hover/parent:text-black",
                      )}
                    >
                      {call.message || formatToolName(call.tool_name)}
                    </p>
                    {hasDetails && (
                      <ChevronIcon
                        isExpanded={isCallExpanded}
                        size={14}
                        className="transition-colors group-hover/parent:text-black"
                      />
                    )}
                  </button>

                  {hasCategoryText && (
                    <p className="text-[11px] capitalize text-zinc-400 dark:text-zinc-500">
                      {getIntegrationName(call) ||
                        call.tool_category
                          .replace(/_/g, " ")
                          .split(" ")
                          .map(
                            (word) =>
                              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
                          )
                          .join(" ")}
                    </p>
                  )}

                  {isCallExpanded && hasDetails && (
                    <div className="mb-3 mt-2 w-fit space-y-2 rounded-xl border border-zinc-200 bg-white p-3 text-[11px] text-black shadow-sm">
                      {call.inputs && Object.keys(call.inputs).length > 0 && (
                        <div className="flex flex-col">
                          <span className="mb-1 font-medium text-black/60">Input</span>
                          {contentRenderer(call.inputs)}
                        </div>
                      )}
                      {call.output && (
                        <div className="flex flex-col">
                          <span className="mb-1 font-medium text-black/60">Output</span>
                          {contentRenderer(call.output)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ToolCallsSection;
