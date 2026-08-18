import {
  APP_FEATURE_IDS,
  APP_FEATURE_META,
  type AppFeatureId,
} from "@mcp-token-footprint/shared";
import { Alert, AlertDescription, Heading, Switch, Text } from "@elabs-ai/components-ui";
import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "../../components/dialogs";
import { useFeatureFlags } from "../feature-flags/feature-flags-context";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Settings › Features — turn whole app capabilities on and off.
 *
 * Immediate-apply, like General (the brand-ui `Switch` contract: a switch that needs a separate
 * Save is the documented anti-pattern) — so this pane publishes NO settings form and shows no
 * footer bar. The one interruption is turning a feature OFF: that hides a run of navigation and
 * makes the feature's endpoints answer 403, so the confirm dialog spells out the blast radius
 * first. Turning one back ON is a plain, instant flip.
 *
 * The switch is app-wide, not per-device: the flag lives in the API's `app_settings` KV and the
 * API enforces it. Hiding the UI alone would not stop a stale tab, a bookmarked deep link, or a
 * direct request.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export function FeaturesSection() {
  const { flags, setFeature } = useFeatureFlags();
  /** The feature whose turn-OFF confirmation is open (null = no prompt). */
  const [confirming, setConfirming] = useState<AppFeatureId | null>(null);
  /** The feature currently being written (its switch is blocked while in flight). */
  const [busy, setBusy] = useState<AppFeatureId | null>(null);

  async function apply(feature: AppFeatureId, enabled: boolean): Promise<void> {
    setBusy(feature);
    try {
      await setFeature({ [feature]: enabled });
    } catch (error) {
      notifyError(`Couldn’t turn ${APP_FEATURE_META[feature].label} ${enabled ? "on" : "off"}.`, {
        description: getErrorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  }

  function onToggle(feature: AppFeatureId, next: boolean): void {
    // Turning ON is instant; turning OFF asks first (it removes navigation and blocks endpoints).
    if (next) void apply(feature, true);
    else setConfirming(feature);
  }

  const pending = confirming ? APP_FEATURE_META[confirming] : null;

  return (
    <SectionFrame>
      <Alert>
        <Info aria-hidden />
        <AlertDescription>
          These switches apply to the whole app, not just this browser. A feature that is off is also
          refused by the server, so nothing keeps running in the background.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col divide-y divide-border">
        {APP_FEATURE_IDS.map((id) => {
          const meta = APP_FEATURE_META[id];
          const enabled = flags[id];
          return (
            <div
              key={id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 max-w-md flex-col gap-0.5">
                <Text className="font-medium" id={`feature-${id}-label`}>
                  {meta.label}
                </Text>
                <Text variant="meta" tone="muted">
                  {meta.description}
                </Text>
              </div>
              <div className="flex min-w-0 shrink-0 items-center gap-3">
                <Text variant="meta" tone="muted">
                  {enabled ? "On" : "Off"}
                </Text>
                <Switch
                  checked={enabled}
                  disabled={busy === id}
                  aria-labelledby={`feature-${id}-label`}
                  onCheckedChange={(next) => onToggle(id, next)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={pending ? `Turn off ${pending.label}?` : ""}
        description="You can turn it back on here at any time. Nothing is deleted — the feature just stops being offered and its endpoints stop answering."
        confirmLabel={pending ? `Turn off ${pending.label}` : "Turn off"}
        busy={busy != null}
        onConfirm={() => {
          const feature = confirming;
          setConfirming(null);
          if (feature) void apply(feature, false);
        }}
      >
        {pending ? (
          <>
            <Text variant="meta" tone="muted">
              While it is off, these disappear:
            </Text>
            <ul className="mt-1 list-disc ps-5">
              {pending.surfaces.map((surface) => (
                <li key={surface}>
                  <Text variant="meta">{surface}</Text>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
    </SectionFrame>
  );
}

/** Local copy of the settings pane frame (title · description · body) — `SettingsView`'s own
 *  `SectionPane` is module-private, and exporting it just for this pane would widen its API. */
function SectionFrame({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 px-8 py-6">
      <div className="flex min-w-0 flex-col gap-1 pe-8">
        <Heading level={2} size="title">
          Features
        </Heading>
        <Text tone="muted" className="text-pretty">
          Turn parts of the app on or off. Changes apply immediately, for everyone using this
          instance.
        </Text>
      </div>
      {children}
    </section>
  );
}
