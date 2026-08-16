import { RefreshCw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, Button, cn } from "@brand/ui";
import { AlertHeading, type AlertHeadingLevel } from "./AlertHeading";

/**
 * The one compact "a fetch failed — let me retry" surface. Replaces the several
 * `catch(() => setX(null))` swallows that made a failed load indistinguishable from a genuinely
 * empty result ("no findings" vs "couldn't load findings"). Render this in the `error` arm of a
 * `loading | error | data` state so the three are visually distinct.
 *
 * Uses `@brand/ui` `Alert variant="destructive"` (semantic `role="alert"`, both themes) with an
 * inline `Retry` `Button` in its `actions` slot — NOT a fake `EmptyState`. Keep it small: a title
 * (what failed) + an optional detail (the error message) + retry.
 *
 * The title renders via `AlertHeading` (not `@brand/ui`'s `AlertTitle` directly) so it lands at the
 * correct outline level instead of always jumping to `<h5>` — see `AlertHeading.tsx` (critique
 * 2026-07-25T20-00-10Z item 2). `level` defaults to 5 (AlertTitle's own hardcoded level), so an
 * existing call site that doesn't pass one renders byte-identical to before; pass the level that
 * continues the surrounding page's outline where this replaces a page's main content (e.g. a failed
 * scan/report — `level={2}`).
 */
export interface InlineErrorProps {
  /** Short statement of WHAT failed to load (e.g. "Couldn't load findings"). */
  title?: string;
  /** Optional detail — typically the extracted error message. */
  detail?: string;
  /** Retry handler. When provided, renders the "Retry" affordance. */
  onRetry?: () => void;
  /** Layout-only className (spacing/width in the host layout). */
  className?: string;
  /** Heading level for the title — see the module doc. @default 5 */
  level?: AlertHeadingLevel;
}

export function InlineError({
  title = "Couldn’t load",
  detail,
  onRetry,
  className,
  level = 5,
}: InlineErrorProps) {
  return (
    <Alert
      variant="destructive"
      className={cn("flex items-start justify-between gap-3", className)}
    >
      <div className="flex min-w-0 items-start gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <AlertHeading level={level}>{title}</AlertHeading>
          {detail ? <AlertDescription className="break-words">{detail}</AlertDescription> : null}
        </div>
      </div>
      {onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry} className="shrink-0">
          <RefreshCw aria-hidden />
          <span>Retry</span>
        </Button>
      ) : null}
    </Alert>
  );
}
