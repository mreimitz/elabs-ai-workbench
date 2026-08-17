import type { TokenProfileRef } from "@mcp-token-footprint/shared";
import { TOKEN_PROFILES } from "@mcp-token-footprint/shared";
import { ToggleGroup, ToggleGroupItem, Tooltip, TooltipContent, TooltipTrigger } from "@elabs-ai/components-ui";
import { TOKEN_PROFILE_META } from "./environment-model-caps";

/**
 * Multi-select token-profile chips WITH per-chip explanation (WP 2.7 · F3 / S19) — explaining what
 * o200k vs cl100k vs estimate vs rough mean and when to pick which (the exact S19 gap: "the group
 * caption explains the group, not the choices"). Wraps each `ToggleGroupItem` in a `Tooltip`
 * carrying the one-line "when to use" copy from {@link TOKEN_PROFILE_META}; it stays a composition
 * of `@elabs-ai/components-*` primitives (no hand-rolled chips), so keyboard/focus come from the library.
 */
export function TokenProfileField(props: {
  value: TokenProfileRef[];
  onChange: (next: TokenProfileRef[]) => void;
  ariaLabel?: string;
}) {
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      value={props.value}
      onValueChange={(next) => props.onChange(next as TokenProfileRef[])}
      className="flex-wrap justify-start"
      aria-label={props.ariaLabel ?? "Token profiles"}
    >
      {TOKEN_PROFILES.map((profile) => {
        const meta = TOKEN_PROFILE_META[profile];
        return (
          <Tooltip key={profile}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={profile}
                className="font-mono text-meta"
                aria-label={`${meta.title} — ${meta.help}`}
              >
                {meta.title}
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{meta.help}</TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}
