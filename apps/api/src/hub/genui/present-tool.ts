// Assistant Hub (WP2.6, R-GUI1/2/4) — the `present` / `prompt_user` emission tools. The model calls one
// of these (silently) to render a declarative UI widget; the tool VALIDATES the spec against the shared
// catalog allowlist (the same `validateGenuiSpec` the browser runs at render time) and drives the bounded
// repair loop. The rendered widget itself comes from the tool_call part's `args` on the web side (the
// engine emits a generic `tool_call` part, tagged `source: "genui"` by the session-service); this tool's
// RESULT is only the model-visible ack / repair-hint / recovery signal — never the UI payload.

import {
  HUB_GENUI_COMPONENT_IDS,
  HUB_GENUI_SPEC_VERSION,
  validateGenuiSpec,
  type GenuiValidationResult,
} from "@mcp-token-footprint/shared";
import { z } from "zod";
import type { HubBuiltinTool } from "../tools/types.js";
import { exhaustionModelMessage, formatRepairHints, GenuiRepairTracker } from "./repair.js";

/**
 * The flat, recursive node zod schema handed to the AI-SDK `tool()` (R-GUI2 — a `$type` enum, an open
 * `props` object, a `children` array of the same node; NO top-level `oneOf`, which providers reject). The
 * enum + its rich description steer the model to the catalog ids; exact per-component prop typing is the
 * runtime validator's job (that drives the repair loop). `z.lazy` gives the recursion; `describe()` on
 * `$type` carries the component list so a provider that surfaces schema descriptions shows the catalog.
 */
type GenuiNodeInput = {
  $type: string;
  $key?: string;
  props?: Record<string, unknown>;
  children?: GenuiNodeInput[];
};

const genuiNodeSchema: z.ZodType<GenuiNodeInput> = z.lazy(() =>
  z.object({
    $type: z
      .enum(HUB_GENUI_COMPONENT_IDS as [string, ...string[]])
      .describe(`One of the catalog components: ${HUB_GENUI_COMPONENT_IDS.join(", ")}.`),
    $key: z.string().optional().describe("Stable identity for a list child (streaming)."),
    props: z
      .record(z.unknown())
      .optional()
      .describe("Typed DATA for this component — structure and data only, never colors/CSS/layout."),
    children: z.array(genuiNodeSchema).optional().describe("Child nodes (container components only)."),
  }),
);

const genuiToolInputSchema = z
  .object({ root: genuiNodeSchema.describe("The root component of the UI tree to render.") })
  .strict();

/** The outcome the web renderer reads off the settled tool_result's `modelContent` to distinguish a
 *  clean presentation from an exhausted-repair recovery (R-GUI4). `presented:true` ⇒ render the widget;
 *  `recovery:"exhausted"` ⇒ render the recovery card. A repair-pending failure returns `isError` instead
 *  (no `modelContent` shape) — the web treats an errored-but-not-recovery genui part as "retrying". */
export type GenuiPresentModelResult =
  | { presented: true; component: string; specVersion: string }
  | { presented: false; recovery: "exhausted"; specVersion: string; note: string };

export type CreateGenuiToolsOptions = {
  /** The bounded repair attempts (`HUB_GENUI_MAX_REPAIR_ATTEMPTS`). */
  maxRepairAttempts: number;
};

/**
 * Build the per-turn `present` + `prompt_user` GenUI emission tools. They SHARE one {@link GenuiRepairTracker}
 * (a repair attempt is a repair attempt regardless of which tool the model reached for). `prompt_user` is
 * `present` with a semantic hint that it expects the user to submit something back — rendering is identical.
 */
export function createGenuiTools(options: CreateGenuiToolsOptions): HubBuiltinTool[] {
  const tracker = new GenuiRepairTracker(Math.max(0, options.maxRepairAttempts));

  const run = (input: unknown): GenuiToolExecuteResult => {
    const parsed = genuiToolInputSchema.safeParse(input);
    if (!parsed.success) {
      // The provider already type-checked against the flat schema, so a parse failure here is unusual —
      // treat it as a validation failure feeding the repair loop with zod's own message.
      const outcome = tracker.recordFailure();
      const errorText = `Fix these errors and re-emit the \`present\` call ONCE:\n${parsed.error.issues
        .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n")}`;
      return finishFailure(outcome.exhausted, outcome.attempt, errorText);
    }
    const result: GenuiValidationResult = validateGenuiSpec(parsed.data.root, "root");
    if (result.ok && result.sanitized) {
      tracker.recordSuccess();
      const modelResult: GenuiPresentModelResult = {
        presented: true,
        component: result.sanitized.$type,
        specVersion: HUB_GENUI_SPEC_VERSION,
      };
      return {
        modelContent: modelResult,
        artifact: { kind: "hub_genui", data: { specVersion: HUB_GENUI_SPEC_VERSION, component: result.sanitized.$type } },
      };
    }
    const outcome = tracker.recordFailure();
    return finishFailure(outcome.exhausted, outcome.attempt, formatRepairHints(result.errors));
  };

  const present: HubBuiltinTool = {
    name: "present",
    source: "builtin",
    description:
      "Render a rich UI widget inline in your reply from the component catalog. Call it silently — say nothing else about it. `root` is a component tree; the user sees the rendered widget. Use it when a table/chart/stat/card conveys the answer better than prose.",
    inputSchema: genuiToolInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(input) {
      return run(input);
    },
  };

  const promptUser: HubBuiltinTool = {
    name: "prompt_user",
    source: "builtin",
    description:
      "Render an interactive widget (usually a Form) to collect structured input from the user. Same catalog + `root` as `present`; use it when you need the user to fill something in — their submission arrives as their next message. Never request passwords, keys, or secrets.",
    inputSchema: genuiToolInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(input) {
      return run(input);
    },
  };

  return [present, promptUser];
}

type GenuiToolExecuteResult = Awaited<ReturnType<HubBuiltinTool["execute"]>>;

/** Shape the failure result: a repair-pending failure is `isError` (fed back as hints); an exhausted one
 *  is a clean `modelContent` recovery signal (NOT an error — the model continues in markdown). */
function finishFailure(exhausted: boolean, attempt: number, hints: string): GenuiToolExecuteResult {
  if (!exhausted) {
    return { modelContent: null, isError: true, errorText: hints };
  }
  const modelResult: GenuiPresentModelResult = {
    presented: false,
    recovery: "exhausted",
    specVersion: HUB_GENUI_SPEC_VERSION,
    note: exhaustionModelMessage(attempt),
  };
  return {
    modelContent: modelResult,
    artifact: { kind: "hub_genui_recovery", data: { reason: "exhausted", attempts: attempt } },
  };
}

/** The genui tool names (for the session-service's `sources` tagging). */
export const GENUI_TOOL_NAMES = ["present", "prompt_user"] as const;
