import { MessageResponse } from "@elabs-ai/components-ai";
import { cn } from "@elabs-ai/components-ui";
import { Link } from "react-router-dom";
import { MD_TABLE_COMPONENTS, type MdComponents } from "../testing/ChatMarkdown";

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
      <MessageResponse components={DOC_MD_COMPONENTS}>{markdown}</MessageResponse>
    </div>
  );
}

/**
 * The renderer's component overrides. Module scope — `MessageResponse` memoizes on the map's
 * identity, so an inline object would re-render the whole document on every keystroke elsewhere.
 *
 * THE LINK OVERRIDE IS NOT COSMETIC, AND A BROWSER IS WHAT FOUND THAT.
 *   Streamdown ships a link-SAFETY behaviour for AI-generated markdown: by default it renders every
 *   markdown link as a `<button data-streamdown="link">` with NO `href`, so the reader has to confirm
 *   before it navigates. Measured against the running container, that made all ~124 cross-references
 *   in the shipped guide inert — they looked like links and did nothing. Overriding `a` replaces
 *   Streamdown's link component outright, which is also the precedent the assistant dock already set
 *   (`features/assistant/AssistantMessageBody.tsx`).
 *
 *   An in-app target (`/docs/…`, `/doc-content/…`, any app route the generator produced) becomes a
 *   router `Link` so it navigates without a full page reload; anything else opens in a new tab with
 *   `rel="noreferrer noopener"` — which `brand-ui docs MessageResponse` names explicitly as the
 *   anti-pattern to avoid.
 *
 * The table map is the app's shared one (`MD_TABLE_COMPONENTS`), imported rather than re-declared:
 * without it Streamdown's own table block carries a "View fullscreen" control that portals a raw
 * edge-to-edge takeover with no chrome. That constant's own docstring says every surface rendering
 * through a bare `MessageResponse` should pass it.
 */
export const DOC_MD_COMPONENTS: MdComponents = {
  ...MD_TABLE_COMPONENTS,
  // `target`/`rel` are destructured OUT of the spread on purpose. The markdown pipeline injects
  // `target="_blank"` on every link it emits, and spreading that onto an in-app `Link` opened the
  // next page of the manual in a NEW TAB — measured in the container, not reasoned about. This
  // component decides the target from the href, so whatever the pipeline supplies cannot leak
  // through in either direction.
  a: ({ node: _node, href, children, target: _target, rel: _rel, ...props }) => {
    // `text-foreground`, not `text-primary` — MEASURED against the running container: the brand lime
    // `--primary` renders link text at 1.36:1 on the light theme's page surface, where WCAG 1.4.3
    // asks 4.5:1. (It is fine in dark, at 12.41:1 — which is exactly why the failure is invisible to
    // anyone testing one theme.) This is the same token whose contrast forced the app-side light
    // focus-ring override documented in `.claude/rules/styling-and-tokens.md`. Foreground measures
    // 13.1:1 light / 15.31:1 dark, and the persistent underline — not colour — is what marks a link,
    // which is also what WCAG 1.4.1 asks for. No `dark:` override and no new colour: one token that
    // reads in both themes.
    const linkClass =
      "font-medium text-foreground underline underline-offset-2 decoration-muted-foreground hover:decoration-foreground";
    if (typeof href === "string" && (href.startsWith("/") || href.startsWith("#"))) {
      return (
        <Link to={href} className={linkClass} {...props}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={linkClass} {...props}>
        {children}
      </a>
    );
  },
};

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
  // Link colour + underline come from the `a` override above (measured contrast); nothing here.
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_table]:my-3 [&_table]:tabular-nums",
  // A screenshot must not blow the reading column open, and must keep its aspect ratio.
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border",
].join(" ");
