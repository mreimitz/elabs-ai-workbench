// Assistant Hub (WP2.6, R-GUI1/2/8) — the ALLOWLISTED renderer registry: `$type` → a `@elabs-ai/components-*`-part-backed
// React renderer. This map IS the render-time security boundary (R-GUI2): a `$type` not present here is
// never rendered. Every renderer reads DATA only from the (already-sanitized) `props` — no colors/styles
// reach a component (R-GUI8); look comes exclusively from `@elabs-ai/components-*` variants + tokens.
//
// Components are backed by the LIVE `@elabs-ai/components-*` library (verified via the vendored `.d.ts`, not guessed):
//   charts  → `@elabs-ai/components-charts` AutoChart (ChartSpec adopted as-is, never-throws)
//   tables  → `@elabs-ai/components-ai` MessageTable (the model-emittable table, never-throws)
//   forms   → `@elabs-ai/components-ai` MessageForm (in-message form + validation, never-throws)
//   stats   → `@elabs-ai/components-ui` MetricCard · data → Descriptions · content → Heading/Text/Alert · layout → Card + flex
//
// The consistency test (`genui-renderer.test.tsx`) asserts this registry covers EXACTLY the shared
// `HUB_GENUI_CATALOG` ids — so the prompt, the validator, and the renderer can never drift (R-GUI1).

import { lazy, Suspense, type ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  Heading,
  MetricCard,
  Text,
  cn,
  type HeadingLevel,
} from "@elabs-ai/components-ui";
import { MessageForm, MessageTable, type FormValues } from "@elabs-ai/components-ai";
import type { ChartSpec } from "@elabs-ai/components-charts";
import { isSafeGenuiUrl, type SanitizedGenuiNode } from "@mcp-token-footprint/shared";
import type { GenuiRenderContext } from "./use-genui-state.js";

// `@elabs-ai/components-charts` pulls in the heavy `@visx/*` tree — lazy-load it so it is only fetched when a Chart
// actually renders (keeps the transcript's initial bundle light and keeps `@visx` out of the eager
// import graph for consumers/tests that never render a chart).
const AutoChart = lazy(() => import("@elabs-ai/components-charts").then((m) => ({ default: m.AutoChart })));

export type GenuiRendererArgs = {
  node: SanitizedGenuiNode;
  ctx: GenuiRenderContext;
  /** Pre-rendered children (container components only). */
  children: ReactNode;
};

export type GenuiRenderer = (args: GenuiRendererArgs) => ReactNode;

// ── typed prop accessors (props are already validated + sanitized; these just narrow) ────────────────

const str = (p: Record<string, unknown>, k: string): string | undefined =>
  typeof p[k] === "string" ? (p[k] as string) : undefined;
const arr = (p: Record<string, unknown>, k: string): Record<string, unknown>[] =>
  Array.isArray(p[k]) ? (p[k] as Record<string, unknown>[]) : [];

const GAP_CLASS: Record<string, string> = { sm: "gap-2", md: "gap-3", lg: "gap-5" };
const GRID_COLS: Record<string, string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
  "4": "sm:grid-cols-2 lg:grid-cols-4",
};
const ALERT_VARIANT: Record<string, "default" | "destructive" | "info" | "success" | "warning"> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "destructive",
};

function deltaDirection(delta?: string): "up" | "down" | "neutral" {
  if (!delta) return "neutral";
  const t = delta.trim();
  if (t.startsWith("-") || /down|▼|↓/i.test(t)) return "down";
  if (t.startsWith("+") || /up|▲|↑/i.test(t)) return "up";
  return "neutral";
}

// ── field/spec mappers (my catalog shape → the brand-ui `FormSpec`/`TableSpec` shapes) ─────────────────

type BrandFieldType = "string" | "number" | "boolean" | "enum";

function mapFormField(f: Record<string, unknown>): Record<string, unknown> {
  const name = str(f, "name") ?? "";
  const label = str(f, "label");
  const type = str(f, "type");
  const base: Record<string, unknown> = { name, ...(label ? { label } : {}) };
  if (str(f, "placeholder")) base.description = str(f, "placeholder");
  if (f.required === true) base.required = true;
  let brandType: BrandFieldType;
  switch (type) {
    case "number":
      brandType = "number";
      break;
    case "checkbox":
      brandType = "boolean";
      break;
    case "select":
      brandType = "enum";
      base.options = arr(f, "options").map((o) => ({
        const: str(o, "value") ?? "",
        ...(str(o, "label") ? { title: str(o, "label") } : {}),
      }));
      break;
    case "textarea":
      brandType = "string";
      base.multiline = true;
      break;
    default:
      brandType = "string";
  }
  base.type = brandType;
  return base;
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────────

export const GENUI_RENDERERS: Record<string, GenuiRenderer> = {
  // layout
  Stack: ({ node, children }) => {
    const dir = str(node.props, "direction");
    const gap = GAP_CLASS[str(node.props, "gap") ?? "md"] ?? "gap-3";
    return (
      <div
        className={cn(
          "flex min-w-0",
          dir === "horizontal" ? "flex-row flex-wrap items-start" : "flex-col",
          gap,
        )}
      >
        {children}
      </div>
    );
  },
  Grid: ({ node, children }) => (
    <div className={cn("grid gap-3", GRID_COLS[str(node.props, "columns") ?? "2"] ?? "sm:grid-cols-2")}>
      {children}
    </div>
  ),
  Card: ({ node, children }) => {
    const title = str(node.props, "title");
    const description = str(node.props, "description");
    return (
      <Card className="min-w-0">
        {title || description ? (
          <CardHeader>
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
        ) : null}
        <CardContent className="flex min-w-0 flex-col gap-3">{children}</CardContent>
      </Card>
    );
  },
  // content
  Heading: ({ node }) => {
    const level = Number(str(node.props, "level") ?? "2");
    return <Heading level={(Number.isFinite(level) ? level : 2) as HeadingLevel}>{str(node.props, "text")}</Heading>;
  },
  Text: ({ node }) => (
    <Text className="min-w-0 whitespace-pre-wrap break-words">{str(node.props, "text")}</Text>
  ),
  Callout: ({ node }) => {
    const title = str(node.props, "title");
    return (
      <Alert variant={ALERT_VARIANT[str(node.props, "variant") ?? "info"] ?? "info"}>
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        <AlertDescription className="whitespace-pre-wrap break-words">{str(node.props, "text")}</AlertDescription>
      </Alert>
    );
  },
  // data
  KeyValue: ({ node }) => (
    <Descriptions>
      {arr(node.props, "items").map((it, i) => (
        <DescriptionsItem key={`${str(it, "label") ?? i}-${i}`} label={str(it, "label")}>
          {str(it, "value")}
        </DescriptionsItem>
      ))}
    </Descriptions>
  ),
  Table: ({ node }) => (
    <MessageTable
      spec={{
        columns: arr(node.props, "columns"),
        rows: arr(node.props, "rows"),
        ...(str(node.props, "caption") ? { caption: str(node.props, "caption") } : {}),
      }}
    />
  ),
  StatGroup: ({ node }) => {
    const stats = arr(node.props, "stats");
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s, i) => {
          const delta = str(s, "delta");
          return (
            <MetricCard
              key={`${str(s, "label") ?? i}-${i}`}
              label={str(s, "label")}
              value={<span className="tabular-nums">{str(s, "value")}</span>}
              {...(str(s, "hint") ? { description: str(s, "hint") } : {})}
              {...(delta ? { delta, deltaDirection: deltaDirection(delta) } : {})}
            />
          );
        })}
      </div>
    );
  },
  // chart (lazy — @elabs-ai/components-charts + @visx are loaded on demand)
  Chart: ({ node }) => (
    <Suspense
      fallback={
        <div className="min-w-0 rounded-md border border-dashed border-border p-3 text-caption text-muted-foreground">
          Loading chart…
        </div>
      }
    >
      <AutoChart spec={node.props.spec as ChartSpec} />
    </Suspense>
  ),
  // media
  Image: ({ node }) => {
    const src = str(node.props, "src");
    if (!src || !isSafeGenuiUrl(src)) return null; // defense-in-depth (the validator also dropped it)
    const caption = str(node.props, "caption");
    return (
      <figure className="min-w-0">
        <img src={src} alt={str(node.props, "alt") ?? ""} className="max-w-full rounded-md border border-border" />
        {caption ? <figcaption className="mt-1 text-caption text-muted-foreground">{caption}</figcaption> : null}
      </figure>
    );
  },
  Link: ({ node }) => {
    const href = str(node.props, "href");
    if (!href || !isSafeGenuiUrl(href)) return null;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="w-fit text-primary underline underline-offset-2"
      >
        {str(node.props, "label")}
      </a>
    );
  },
  // input (two-tier interactivity — R-GUI5)
  Form: ({ node, ctx }) => {
    const name = str(node.props, "name") ?? "form";
    const spec = {
      formName: name,
      fields: arr(node.props, "fields").map(mapFormField),
      ...(str(node.props, "submitLabel") ? { submitLabel: str(node.props, "submitLabel") } : {}),
    };
    return (
      <MessageForm
        spec={spec}
        values={ctx.formValues(name) as FormValues | undefined}
        submitted={ctx.formSubmitted(name)}
        disabled={!ctx.interactive}
        onChange={(values) => ctx.onFormChange(name, values as Record<string, unknown>)}
        onSubmit={({ values }) =>
          ctx.onFormSubmit({
            formName: name,
            values: values as Record<string, unknown>,
            ...(str(node.props, "humanMessage") ? { humanMessage: str(node.props, "humanMessage") } : {}),
            ...(str(node.props, "llmMessage") ? { llmMessage: str(node.props, "llmMessage") } : {}),
          })
        }
      />
    );
  },
  Button: ({ node, ctx }) => {
    const action = str(node.props, "action");
    const label = str(node.props, "label") ?? "Action";
    const message = str(node.props, "message") ?? label;
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-fit"
        disabled={!ctx.interactive}
        onClick={() => (action === "reset" ? ctx.onReset() : ctx.onSend(message))}
      >
        {label}
      </Button>
    );
  },
};

/** The set of `$type`s this renderer knows how to render — the render-time allowlist membership set. */
export const GENUI_RENDERER_IDS: readonly string[] = Object.keys(GENUI_RENDERERS);
