import { Text, cn } from "@elabs-ai/components-ui";
import { Check, X } from "lucide-react";
import { runChipLabel } from "../compare-runs";
import { RunLetterBadge } from "../RunLetterBadge";
import { toolRibbon } from "./flow-derive";
import type { FlowLane } from "./flow-types";

/**
 * Tools lens (audit §H4) — reduce each run to ONE legible ribbon of ordered tool-call chips
 * (`search ✓ · create_data_object ✗ · create_data_object ✓ · get_fields ✓`). Count / order / failure
 * differences become visible in a single line per run.
 */
export function ToolsRibbon({ lanes }: { lanes: FlowLane[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-3">
        {lanes.map((lane) => {
          const ribbon = toolRibbon(lane);
          return (
            <div
              key={lane.letter}
              className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <RunLetterBadge
                  letter={lane.letter}
                  color={lane.color}
                  baseline={lane.isBaseline}
                  size="md"
                />
                <Text variant="caption" className="min-w-0 truncate font-medium">
                  {runChipLabel(lane.run)}
                </Text>
                <Text variant="caption" tone="muted" className="ml-auto tabular-nums">
                  {ribbon.length} tool call{ribbon.length === 1 ? "" : "s"}
                </Text>
              </div>
              {ribbon.length === 0 ? (
                <Text variant="caption" tone="muted" className="italic">
                  No tool calls in this run
                </Text>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {ribbon.map((item, i) => (
                    <div key={item.id} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-muted-foreground">·</span>}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-caption",
                          item.failed
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-border bg-muted/30",
                          item.isSkill && "border-primary/40",
                        )}
                      >
                        {item.toolName}
                        {item.failed ? (
                          <X aria-hidden className="size-3" />
                        ) : (
                          <Check aria-hidden className="size-3 text-success" />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
