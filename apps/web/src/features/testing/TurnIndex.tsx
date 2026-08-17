import { useMemo } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Text } from "@elabs-ai/components-ui";
import { AlertTriangle, ListOrdered } from "lucide-react";
import { formatNumber } from "../../lib/format";
import { deriveTurnRows } from "./turn-index";

/**
 * WP 3.2 — the turn index in the monitoring rail: a clickable list of the run's settled turns with
 * per-turn tokens (↑/↓). Clicking a row scrolls the CHAT to that turn (the shared console-anchor
 * navigation), so a terminal run is navigable turn-by-turn from the rail. Renders nothing until the
 * run has produced at least one settled turn (nothing to index yet).
 */
export function TurnIndex({
  steps,
  onSelectTurn,
}: {
  steps: RunStep[];
  /** Reveal the chat and scroll it to this 0-based turn. */
  onSelectTurn: (turnIndex: number) => void;
}) {
  const rows = useMemo(() => deriveTurnRows(steps), [steps]);
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>
          <span className="flex items-center gap-2">
            <ListOrdered aria-hidden className="size-4" />
            Turns
            <Badge variant="secondary" className="font-normal tabular-nums">
              {formatNumber(rows.length)}
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.turnIndex}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left font-normal"
                onClick={() => onSelectTurn(row.turnIndex)}
                title={`Jump to turn ${row.turnNo} in the chat`}
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="shrink-0 font-medium tabular-nums">Turn {row.turnNo}</span>
                  {row.hasError ? (
                    <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-destructive" />
                  ) : null}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {row.tokensIn > 0 ? (
                      <Text as="span" variant="meta" tone="muted" className="tabular-nums">
                        {formatNumber(row.tokensIn)}↑
                      </Text>
                    ) : null}
                    {row.tokensOut > 0 ? (
                      <Text as="span" variant="meta" tone="muted" className="tabular-nums">
                        {formatNumber(row.tokensOut)}↓
                      </Text>
                    ) : null}
                    {row.toolCalls > 0 ? (
                      <Badge variant="outline" className="font-normal tabular-nums">
                        {formatNumber(row.toolCalls)} tool{row.toolCalls === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
