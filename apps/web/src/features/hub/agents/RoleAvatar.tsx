import { parseHubIcon } from "@mcp-token-footprint/shared";
import { ModelSelectorLogo } from "@brand/ai";
import { cn } from "@brand/ui";
import { Bot } from "lucide-react";
import { inferModelLogoProvider } from "../use-hub-models";
import { HUB_ICON_BY_NAME } from "./hub-icon-library";

/**
 * Assistant Hub — the agent/crew avatar. Resolution order (owner request: "real icons for my agents"):
 *   1. `icon` is an uploaded image (`data:` URI)     → render the image (`@brand/ui` `Avatar`).
 *   2. `icon` is a known curated glyph (`lucide:<n>`) → render that glyph in a tinted circle.
 *   3. otherwise, if `model` maps to a provider       → the model provider logo (`ModelSelectorLogo`).
 *   4. fallback                                       → a generic `Bot` glyph in a tinted circle.
 *
 * `icon`/`model` are OPTIONAL and additive. The fallback used to be `@brand/ai`'s animated `Persona`
 * (a Rive/WebGL glyph), but on a dense surface — e.g. a mission with many agents rendered across the
 * graph nodes, report cards, detail box and rail at once — the WebGL contexts get exhausted and the
 * canvas paints as a large EMPTY circle. The deterministic `Bot`-in-a-circle below always renders at
 * the requested size, in both themes, with no WebGL, so an agent without a custom icon still reads as
 * a real avatar instead of a gray blob. Its accent colour is picked deterministically from the id so
 * different agents stay visually distinct.
 */
const AVATAR_ACCENT_TEXT = [
  "text-[var(--chart-1)]",
  "text-[var(--chart-2)]",
  "text-[var(--chart-3)]",
  "text-[var(--chart-4)]",
  "text-[var(--chart-5)]",
] as const;

/** A stable index in `[0, mod)` from a string (not random) so the same id always maps the same way. */
function hashIndex(seed: string, mod: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % mod;
}

export function RoleAvatar({
  id,
  icon,
  model,
  className,
}: {
  id: string;
  /** The stored `icon` value (`parseHubIcon` encoding). Absent ⇒ resolve via `model`, then the glyph. */
  icon?: string;
  /** The entity's default model id — used for the "model image" fallback when no icon is set. */
  model?: string;
  className?: string;
}) {
  const parsed = parseHubIcon(icon);

  if (parsed.kind === "image") {
    // A SQUARE image only fits fully inside a CIRCLE when it occupies ≤ 1/√2 ≈ 70.7% of the box (its
    // corners must stay inside the inscribed circle). Render the uploaded image as a plain <img> at
    // 70% of the box, centered on a theme-aware `bg-muted` backing inside a clipping circle — the whole
    // logo shows, corners never clipped. (NOT Radix `AvatarImage`: its load-gating combined with the
    // padding trick left the image blank / unsized — the plain <img> always paints at the right size.)
    return (
      <span
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted",
          className,
        )}
      >
        {/* brand-ui-allow: no @brand circular image-avatar reliably renders a CONTAINED (uncropped)
            uploaded logo at an explicit size; the plain <img> is the minimal correct primitive here. */}
        <img src={parsed.src} alt="" className="size-[70%] object-contain" />
      </span>
    );
  }

  if (parsed.kind === "lucide") {
    const Icon = HUB_ICON_BY_NAME[parsed.name];
    if (Icon) {
      return (
        <span
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-full bg-muted text-foreground",
            className,
          )}
        >
          <Icon aria-hidden className="size-[55%]" />
        </span>
      );
    }
    // Unknown glyph name (e.g. a legacy free-text value) — fall through to model/glyph.
  }

  const provider = model ? inferModelLogoProvider(model) : undefined;
  if (provider) {
    return (
      <span
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full bg-muted",
          className,
        )}
      >
        <ModelSelectorLogo provider={provider} className="size-[62%]" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full bg-muted",
        className,
      )}
    >
      <Bot aria-hidden className={cn("size-[55%]", AVATAR_ACCENT_TEXT[hashIndex(id, 5)])} />
    </span>
  );
}
