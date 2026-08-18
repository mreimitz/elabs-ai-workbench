import { type AppFeatureId, APP_FEATURE_META } from "@mcp-token-footprint/shared";
import { Button, EmptyState } from "@elabs-ai/components-ui";
import { PowerOff, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { PageShell } from "../../components/PageShell";

/**
 * The "this feature is turned off" panel a disabled feature's routes render instead of their real
 * view (Settings › Features).
 *
 * Why a panel and not a redirect or a 404: a bookmarked `/assistant/agents` that silently bounces to
 * the dashboard reads as a broken link, and a 404 reads as a bug. This says what happened and offers
 * the one-click way back — the deep link to the Features section that owns the switch.
 *
 * The route itself is untouched: `App.tsx` still declares the same `path="…"` literals, so the
 * `assistant-route-operability` gate keeps matching the shared route manifest byte for byte.
 */
export function FeatureDisabledView({ feature }: { feature: AppFeatureId }) {
  const meta = APP_FEATURE_META[feature];
  return (
    <PageShell>
      <EmptyState
        icon={<PowerOff aria-hidden />}
        title={`${meta.label} is turned off`}
        // EmptyState renders the description inside a <p>, so this stays span-only (a nested <p>
        // is invalid HTML and React warns on it) — the muted type comes from EmptyState itself.
        description={
          <span className="flex flex-col gap-2">
            <span>{meta.description}</span>
            <span>Turn it back on in Settings › Features to use this page again.</span>
          </span>
        }
        actions={
          <Button asChild>
            <Link to="/settings/features">
              <Settings2 aria-hidden />
              Open Settings › Features
            </Link>
          </Button>
        }
      />
    </PageShell>
  );
}
