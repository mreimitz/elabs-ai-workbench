/**
 * kpi-identity.guardrail.test.tsx — T1 (design-remediation) guardrail: a KPI's value and its label
 * never share a size role.
 *
 * The defect in component form (critique P1 typography, and the "Descriptions renders label and
 * value identically" observation): `KpiStat` used to render BOTH its `<dt>` label and its `<dd>`
 * value at `variant="meta"` — same size, only weight/tone apart — so "64,522" was styled the same as
 * the word "Startup tokens" beside it. T1 rebuilt `KpiStat` so the value renders on a headline rung
 * (`kpi` in the default stacked KPI card, `subtitle` in dense inline strips) while the label stays a
 * small muted eyebrow (`meta`).
 *
 * This is a STRUCTURAL assertion (which size ROLE each node carries), not a computed-px one — jsdom
 * does not resolve the CSS-var font sizes. It renders the real component through
 * `@testing-library/react` and reads the size-role class off the label vs. the value node, asserting
 * they differ and that the value sits on a headline rung.
 *
 * NOTE on `Text` variants: the size roles Text actually emits are meta/caption/body/kpi/code;
 * subtitle/title/display are Heading-only. So the stacked value uses `kpi` and the inline value
 * uses `body` — both of which strictly out-rank the `meta` label.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiStat } from "../components/KpiStat";

/** The @brand/ui `Text` size ROLES (variant → `text-<role>`); NOT color/utility `text-*` classes. */
const SIZE_ROLES = ["kpi", "display", "title", "subtitle", "body", "caption", "meta", "code"] as const;
type SizeRole = (typeof SIZE_ROLES)[number];

/** A rough ordering so "the value out-sizes the label" is checkable, not just "they differ". */
const ROLE_RANK: Record<SizeRole, number> = {
  meta: 0,
  caption: 1,
  code: 1,
  body: 2,
  subtitle: 3,
  title: 4,
  display: 5,
  kpi: 6,
};

/** The size role a node carries, from its className — matches ONLY the known size roles (so
 *  `text-muted-foreground`, `text-wrap-balance`, … are never mistaken for a size). */
function sizeRole(el: Element): SizeRole | null {
  for (const role of SIZE_ROLES) {
    if (new RegExp(`(?:^|\\s)text-${role}(?:$|\\s)`).test(el.className)) return role;
  }
  return null;
}

function nodes(orientation?: "stack" | "inline") {
  const { container } = render(
    <KpiStat label="Startup tokens" value="64,522" orientation={orientation} />,
  );
  const dl = container.querySelector("dl");
  const dt = container.querySelector("dt");
  const dd = container.querySelector("dd");
  if (!dl || !dt || !dd) throw new Error("KpiStat must render a <dl>/<dt>/<dd> triple");
  const labelEl = dt.querySelector("span");
  const valueEl = dd.querySelector("span");
  if (!labelEl || !valueEl) throw new Error("KpiStat must render a label span and a value span");
  return { dl, dt, dd, labelEl, valueEl };
}

describe("GUARDRAIL T1 — KpiStat value and label carry DISTINCT size roles", () => {
  it("keeps the accessible <dl>/<dt>/<dd> pairing", () => {
    const { dl, dt, dd } = nodes();
    expect(dl.tagName).toBe("DL");
    expect(dt.tagName).toBe("DT");
    expect(dd.tagName).toBe("DD");
  });

  it("default (stacked KPI card): value on the `kpi` headline rung, label on `meta`", () => {
    const { labelEl, valueEl } = nodes();
    const labelRole = sizeRole(labelEl);
    const valueRole = sizeRole(valueEl);

    expect(labelRole, `label should be the small eyebrow (meta), was ${labelRole}`).toBe("meta");
    expect(
      valueRole,
      `value should sit on a headline rung (kpi/display), was ${valueRole}`,
    ).toMatch(/^(kpi|display)$/);

    // The whole point: they must NOT share a size role.
    expect(valueRole).not.toBe(labelRole);
    // …and the value out-sizes the label, not merely differs.
    expect(ROLE_RANK[valueRole as SizeRole]).toBeGreaterThan(ROLE_RANK[labelRole as SizeRole]);
  });

  it("the value carries tabular-nums (digit alignment for the numerals this product produces)", () => {
    const { valueEl } = nodes();
    expect(valueEl.className).toMatch(/(?:^|\s)tabular-nums(?:$|\s)/);
  });

  it("inline (dense strip): value still out-sizes the meta label, keeping strips dense", () => {
    const { labelEl, valueEl } = nodes("inline");
    const labelRole = sizeRole(labelEl);
    const valueRole = sizeRole(valueEl);

    expect(labelRole).toBe("meta");
    expect(valueRole, `inline value size role was ${valueRole}`).not.toBeNull();
    expect(valueRole).not.toBe(labelRole);
    expect(ROLE_RANK[valueRole as SizeRole]).toBeGreaterThan(ROLE_RANK[labelRole as SizeRole]);
  });
});
