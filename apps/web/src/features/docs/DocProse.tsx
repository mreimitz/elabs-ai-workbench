import { MessageResponse } from "@elabs-ai/components-ai";
import { cn } from "@elabs-ai/components-ui";

/**
 * DocProse — one page of the shipped guide, rendered at DOCUMENT scale.
 * =================================================================================================
 *
 * NO NEW MARKDOWN ENGINE (`.claude/rules/dependencies.md` — a new runtime dependency is owner-gated).
 * `MessageResponse` from `@elabs-ai/components-ai` is the renderer the app already ships and already
 * bundles; `features/skills/SkillOverview.tsx` uses it exactly this way for a rendered `SKILL.md`.
 * The chat wrapper (`features/testing/ChatMarkdown`) is deliberately NOT reused here: it flattens
 * `h2`–`h6` to body size and folds long tables behind a disclosure, which is right for a streamed
 * reply and wrong for a manual whose whole structure is its headings.
 *
 * MEASURE CAP (D-IC9). The container carries `max-w-[76ch]`. That is not decoration — the
 * `prose-measure` guard (`.claude/hooks/prose-measure.mjs`, gated by
 * `guardrails/prose-measure.guardrail.test.ts`) flags a `MessageResponse` container introduced with
 * no cap, because an uncapped reading column runs edge to edge on a wide monitor. Tables and images
 * inside the document still scroll/scale within it.
 *
 * Semantic tokens only, so it reads in both themes; `className` stays layout-only.
 */
export function DocProse({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn("min-w-0 max-w-[76ch] text-body text-foreground", DOC_PROSE, className)}>
      <MessageResponse>{markdown}</MessageResponse>
    </div>
  );
}

/**
 * Document-scale typography. Arbitrary-variant utilities re-target the raw tags the renderer emits;
 * `!` beats the library's own equal-specificity prose root. Heading hierarchy is PRESERVED (h1 > h2 >
 * h3 …) — the opposite of the chat renderer — because a manual page is navigated by its headings.
 */
const DOC_PROSE = [
  "[&_h1]:!mt-6 [&_h1]:!mb-3 [&_h1]:!text-title [&_h1]:!font-semibold [&_h1]:!text-foreground [&_h1:first-child]:!mt-0",
  "[&_h2]:!mt-6 [&_h2]:!mb-2 [&_h2]:!text-subtitle [&_h2]:!font-semibold [&_h2]:!text-foreground",
  "[&_h3]:!mt-5 [&_h3]:!mb-2 [&_h3]:!text-body [&_h3]:!font-semibold [&_h3]:!text-foreground",
  "[&_h4]:!mt-4 [&_h4]:!mb-1.5 [&_h4]:!text-body [&_h4]:!font-semibold [&_h4]:!text-foreground",
  "[&_h5]:!mt-4 [&_h5]:!mb-1 [&_h5]:!text-body [&_h5]:!font-medium [&_h5]:!text-foreground",
  "[&_h6]:!mt-4 [&_h6]:!mb-1 [&_h6]:!text-body [&_h6]:!font-medium [&_h6]:!text-foreground",
  "[&_p]:!my-3 [&_p]:!leading-relaxed",
  "[&_ul]:!my-3 [&_ul]:!ps-5 [&_ul]:!list-disc [&_ol]:!my-3 [&_ol]:!ps-5 [&_ol]:!list-decimal [&_li]:!my-1",
  "[&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-caption",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_table]:my-3 [&_table]:tabular-nums",
  // A screenshot must not blow the reading column open, and must keep its aspect ratio.
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border",
].join(" ");
