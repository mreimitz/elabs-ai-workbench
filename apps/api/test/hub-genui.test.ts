// Assistant Hub (roadmap/assistant-hub/, WP2.6, R-GUI1–8) — the Declarative GenUI module: the shared
// catalog registry/validator (allowlist = the security boundary), the prompt + JSON-schema compilers
// (regenerated from the one registry so they can't disagree), the bounded machine-hinted repair loop,
// and the `present`/`prompt_user` emission tools. Security-critical acceptance: allowlist bypass, prop
// injection, `javascript:`/unvetted `src` URLs, repair-loop exhaustion honesty.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HUB_GENUI_CATALOG,
  HUB_GENUI_COMPONENT_IDS,
  HUB_GENUI_SPEC_VERSION,
  buildGenuiSubmitMessage,
  isSafeGenuiUrl,
  stampGenuiSurfaceState,
  validateGenuiSpec,
} from "@mcp-token-footprint/shared";
import {
  buildUpdateSurfaceTool,
  compileGenuiCatalogPrompt,
  compileGenuiToolJsonSchema,
  createGenuiTools,
  formatRepairHints,
  UPDATE_SURFACE_PARTIAL_WORDING,
} from "../src/hub/genui/index.js";

// ── R-GUI1: ONE registry compiles prompt + validator + JSON-schema; they can't disagree ─────────────

test("R-GUI1: prompt catalog, JSON-schema, and validator all cover the SAME component set", () => {
  const ids = new Set(HUB_GENUI_COMPONENT_IDS);
  assert.ok(ids.size >= 8, "catalog should be non-trivial");

  // The prompt lists every component id.
  const { catalogText, specVersion } = compileGenuiCatalogPrompt();
  assert.equal(specVersion, HUB_GENUI_SPEC_VERSION);
  for (const id of ids) {
    assert.ok(catalogText.includes(`\`${id}\``), `prompt catalog must list ${id}`);
  }

  // The JSON-schema's `$type` enum is exactly the catalog ids.
  const schema = compileGenuiToolJsonSchema();
  const nodeDef = (schema.properties as { root: { $defs: { node: { properties: { $type: { enum: string[] } } } } } })
    .root.$defs.node.properties.$type.enum;
  assert.deepEqual([...nodeDef].sort(), [...ids].sort());

  // The validator accepts every component id at the root (with its required props) and rejects a
  // fabricated one — same allowlist the schema + prompt were built from.
  assert.equal(validateGenuiSpec({ $type: "Heading", props: { text: "hi" } }).rootRenderable, true);
  assert.equal(validateGenuiSpec({ $type: "NotAComponent" }).rootRenderable, false);
});

// ── R-GUI2: allowlist validation IS the security boundary ───────────────────────────────────────────

test("R-GUI2 security: an unknown component never renders (allowlist bypass rejected)", () => {
  const result = validateGenuiSpec({ $type: "script", props: { src: "http://evil" } });
  assert.equal(result.ok, false);
  assert.equal(result.rootRenderable, false);
  assert.equal(result.sanitized, null);
  assert.ok(result.errors.some((e) => e.code === "unknown_component"));
});

test("R-GUI2 security: an unknown/injected prop is a typed error and is dropped from the sanitized tree", () => {
  const result = validateGenuiSpec({
    $type: "Text",
    props: {
      text: "hello",
      // Injection attempts — none of these are declared props, so all are rejected + dropped.
      style: "position:fixed",
      className: "hack",
      onClick: "alert(1)",
      dangerouslySetInnerHTML: { __html: "<img onerror=alert(1)>" },
      color: "#ff0000",
    },
  });
  assert.equal(result.ok, false, "unknown props are errors");
  assert.equal(result.rootRenderable, true, "the known `text` prop keeps the node renderable");
  assert.deepEqual(Object.keys(result.sanitized?.props ?? {}), ["text"], "only `text` survives");
  const rejected = result.errors.filter((e) => e.code === "unknown_prop").map((e) => e.path);
  for (const p of ["style", "className", "onClick", "dangerouslySetInnerHTML", "color"]) {
    assert.ok(rejected.some((path) => path.endsWith(`.${p}`)), `${p} must be rejected`);
  }
});

test("R-GUI2 security: no style/color prop exists anywhere in the catalog (tokens only — R-GUI8)", () => {
  const banned = /^(style|classname|class|color|background|css|onclick|onerror|href|src)$/i;
  for (const comp of HUB_GENUI_CATALOG) {
    for (const propName of Object.keys(comp.props)) {
      // `src`/`href` ARE allowed but only as `url`-kind (validated); nothing style/color-bearing exists.
      if (propName === "src" || propName === "href") {
        assert.equal(comp.props[propName]?.kind, "url", `${comp.id}.${propName} must be a validated url`);
        continue;
      }
      assert.ok(!banned.test(propName), `${comp.id}.${propName} looks style/script-bearing`);
    }
  }
});

test("R-GUI2 security: javascript:/data:/file:/scheme-relative URLs are rejected; http(s) pass", () => {
  assert.equal(isSafeGenuiUrl("https://example.com/x.png"), true);
  assert.equal(isSafeGenuiUrl("http://example.com"), true);
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "blob:https://x",
    "//evil.com/x.png",
    "/api/secret",
    "relative/path",
    "",
  ]) {
    assert.equal(isSafeGenuiUrl(bad), false, `${bad} must be rejected`);
  }
  // In a real spec: an Image with a javascript: src is unrenderable (required url prop failed).
  const img = validateGenuiSpec({ $type: "Image", props: { src: "javascript:alert(1)", alt: "x" } });
  assert.equal(img.rootRenderable, false);
  assert.ok(img.errors.some((e) => e.code === "unsafe_url"));
});

test("R-GUI3/4: invalid children are dropped (never null holes); valid portions still render", () => {
  const result = validateGenuiSpec({
    $type: "Stack",
    children: [
      { $type: "Heading", props: { text: "Good" } },
      { $type: "Bogus", props: {} }, // unknown → dropped
      { $type: "Text", props: { text: "Also good" } },
      { $type: "Text", props: {} }, // missing required `text` → dropped
    ],
  });
  assert.equal(result.rootRenderable, true);
  assert.equal(result.ok, false, "there were invalid children");
  assert.deepEqual(
    result.sanitized?.children.map((c) => c.$type),
    ["Heading", "Text"],
    "only the two valid children survive, in order (no holes)",
  );
});

test("R-GUI2: a leaf component cannot carry children", () => {
  const result = validateGenuiSpec({ $type: "Text", props: { text: "x" }, children: [{ $type: "Text", props: { text: "y" } }] });
  assert.ok(result.errors.some((e) => e.code === "children_not_allowed"));
  assert.deepEqual(result.sanitized?.children, []);
});

// ── R-GUI4: bounded machine-hinted repair loop → recovery on exhaustion; valid portions render ───────

test("R-GUI4: repair hints name the errors and the available components", () => {
  const { errors } = validateGenuiSpec({ $type: "Nope" });
  const hint = formatRepairHints(errors);
  assert.match(hint, /Fix these errors/);
  assert.match(hint, /Available components:/);
  assert.match(hint, /plain markdown/);
});

test("R-GUI4: present tool feeds hints for maxRepairAttempts, then returns an honest recovery envelope", async () => {
  const [present] = createGenuiTools({ maxRepairAttempts: 2 });
  const badInput = { root: { $type: "Nope" } };

  // Attempt 1 (first re-emit) → isError with hints (repairing).
  const r1 = await present!.execute(badInput, {} as never);
  assert.equal(r1.isError, true);
  assert.match(String(r1.errorText), /Fix these errors/);

  // Attempt 2 (second re-emit) → still repairing.
  const r2 = await present!.execute(badInput, {} as never);
  assert.equal(r2.isError, true);

  // Attempt 3 exceeds the budget → NOT an error; a clean recovery signal telling the model to stop.
  const r3 = await present!.execute(badInput, {} as never);
  assert.notEqual(r3.isError, true);
  const mc = r3.modelContent as { presented: boolean; recovery?: string };
  assert.equal(mc.presented, false);
  assert.equal(mc.recovery, "exhausted");
  assert.equal(r3.artifact?.kind, "hub_genui_recovery");
});

test("R-GUI4: a SUCCESSFUL emission resets the repair budget", async () => {
  const [present] = createGenuiTools({ maxRepairAttempts: 1 });
  await present!.execute({ root: { $type: "Nope" } }, {} as never); // fail 1
  const ok = await present!.execute({ root: { $type: "Heading", props: { text: "Hi" } } }, {} as never);
  const okMc = ok.modelContent as { presented: boolean; component?: string; specVersion?: string };
  assert.equal(okMc.presented, true);
  assert.equal(okMc.component, "Heading");
  assert.equal(okMc.specVersion, HUB_GENUI_SPEC_VERSION);
  assert.equal(ok.artifact?.kind, "hub_genui");
  // Budget reset: the next failure gets a fresh repair attempt (isError), not immediate exhaustion.
  const again = await present!.execute({ root: { $type: "Nope" } }, {} as never);
  assert.equal(again.isError, true);
});

test("present tool validates a rich real widget (Card > Stack > Chart/Table/Form) end-to-end", async () => {
  const [present, promptUser] = createGenuiTools({ maxRepairAttempts: 2 });
  assert.equal(present!.name, "present");
  assert.equal(promptUser!.name, "prompt_user");
  const spec = {
    root: {
      $type: "Card",
      props: { title: "Revenue" },
      children: [
        {
          $type: "Stack",
          children: [
            {
              $type: "Chart",
              props: {
                spec: {
                  type: "bar",
                  x: "month",
                  series: ["revenue"],
                  data: [
                    { month: "Jan", revenue: 42 },
                    { month: "Feb", revenue: 48 },
                  ],
                },
              },
            },
            {
              $type: "Table",
              props: {
                columns: [
                  { key: "month", label: "Month" },
                  { key: "revenue", label: "Revenue" },
                ],
                rows: [{ month: "Jan", revenue: 42 }],
              },
            },
            {
              $type: "Form",
              props: {
                name: "followup",
                fields: [{ name: "q", label: "Question", type: "text" }],
              },
            },
          ],
        },
      ],
    },
  };
  const result = await present!.execute(spec, {} as never);
  const mc = result.modelContent as { presented: boolean };
  assert.equal(mc.presented, true, JSON.stringify(result));
});

// ── R-GUI5/6: dual-audience + editable-surface snapshot contract ────────────────────────────────────

test("R-GUI5/6: the submit message leads with the human line and trails the stamped machine state", () => {
  const text = buildGenuiSubmitMessage({
    humanFriendlyMessage: "Submitted the follow-up form.",
    llmFriendlyMessage: "The user answered the classification form.",
    surfaceName: "followup",
    surfaceId: "w1",
    formState: { q: "why?" },
  });
  assert.match(text, /^Submitted the follow-up form\./);
  assert.match(text, /The user answered the classification form\./);
  assert.match(text, /\[Current state of "followup" \(id: w1\): \{"q":"why\?"\}\]/);
});

test("R-GUI6: stampGenuiSurfaceState keeps ids model-visible; update_{name} carries partial-update wording", async () => {
  assert.equal(stampGenuiSurfaceState("plan", "p1", { title: "X" }), '[Current state of "plan" (id: p1): {"title":"X"}]');
  const applied: Record<string, unknown>[] = [];
  const tool = buildUpdateSurfaceTool({
    name: "Plan Card",
    fields: [
      { name: "title", kind: "string", description: "Plan title." },
      { name: "done", kind: "boolean", description: "Whether complete." },
    ],
    apply: (patch) => {
      applied.push(patch);
      return { ok: true };
    },
  });
  assert.equal(tool.name, "update_plan_card");
  assert.match(tool.description, new RegExp(UPDATE_SURFACE_PARTIAL_WORDING.slice(0, 20)));
  // Partial update: omitted fields are simply absent (kept as-is by the surface).
  await tool.execute({ title: "New" }, {} as never);
  assert.deepEqual(applied, [{ title: "New" }]);
});
