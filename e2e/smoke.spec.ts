import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  HUB_E2E_ARTIFACT_MESSAGE,
  HUB_E2E_ARTIFACT_REPLY,
  HUB_E2E_ARTIFACT_TITLE,
  HUB_E2E_AUTO_AMBIGUOUS_ASK,
  HUB_E2E_AUTO_MISSION_ASK,
  HUB_E2E_AUTO_MISSION_CHOICE,
  HUB_E2E_AUTO_TRIVIAL_ASK,
  HUB_E2E_CHAT_REPLY,
  HUB_E2E_MCP_AGENT_MARKER,
  HUB_E2E_MISSION_ASK,
  HUB_E2E_READONLY_TOOL_NAME,
  HUB_E2E_STUB_MODEL_ID,
  HUB_E2E_SYNTHESIS_STAT_LABEL,
  HUB_E2E_SYNTHESIS_TEXT,
  startHubStubLlmServer,
  type HubStubLlmServer,
} from "./fixtures/hub-stub-llm-server.js";

// Full-stack happy-path smoke (#29): seed the stdio echo-server MCP fixture via the API (deterministic
// — favours reliability over driving the multi-step add-server wizard), then drive the scan and the
// report entirely through the built web UI, asserting the token footprint / ranked tools and the
// generated report actually render.

const rootDir = path.dirname(fileURLToPath(import.meta.url));
/** The fixed stdio MCP fixture shipped with the API tests — a one-tool ("echo") server over stdio. */
const echoServer = path.resolve(
  rootDir,
  "..",
  "apps",
  "api",
  "test",
  "fixtures",
  "echo-mcp-server.mjs",
);
/** hub-fixes WP2.1 — a stdio MCP fixture whose single tool (`read_echo`) is READ-ONLY-annotated, so a
 *  granted mission agent (which auto-runs only read-only tools under mission `auto`) actually calls it. */
const readonlyEchoServer = path.resolve(
  rootDir,
  "..",
  "apps",
  "api",
  "test",
  "fixtures",
  "readonly-echo-mcp-server.mjs",
);

test("add stdio server → scan → view report", async ({ page, request }) => {
  // 1. Seed the echo-server fixture through the real API (POST /api/servers).
  const created = await request.post("/api/servers", {
    data: {
      name: "Echo E2E",
      transport: "stdio",
      command: "node",
      args: [echoServer],
    },
  });
  expect(created.ok(), `POST /api/servers failed: ${created.status()}`).toBeTruthy();
  const server = (await created.json()) as { id: string; name: string };
  expect(server.id).toBeTruthy();

  // 2. Open the seeded server in the UI. It has no scan yet.
  await page.goto(`/servers/${server.id}`);
  await expect(page.getByText("Echo E2E").first()).toBeVisible();
  // T7 (fix commit 1bd44581) renamed the never-scanned server-health state: it was a colour-only
  // token number that looked identical to a healthy server; each state now carries a labelled
  // StatusBadge, so a never-scanned server reads "Not scanned" in the server rail (ServerRail.tsx
  // `serverHealth`). Was: getByText("unscanned").
  await expect(page.getByText("Not scanned").first()).toBeVisible();

  // 3. Run a scan from the header action. Per S6 (server-detail header, commit f6ac558b — this
  // predates the def8205b remediation baseline; the old `aria-label="Run scan"` icon-button locator
  // was already stale), scan is the app's single most important action and is a LABELLED primary
  // button ("Scan now" / "Scanning…" while busy), not an icon button. Drive that real control.
  await page.getByRole("button", { name: "Scan now" }).click();

  // The scan settling flips the "Tools" tab to its discovered count — the echo server exposes 1 tool.
  // TabPanel renders the count as a muted suffix span ("Tools 1", accessible name space-joined), not
  // the old parenthesized "Tools (1)" this locator assumed — that format predates the def8205b
  // remediation baseline (TabPanel.tsx has always rendered `label` + `{count}`).
  await expect(page.getByRole("tab", { name: /Tools 1/ })).toBeVisible();

  // 4. Assert the token footprint / ranked tools rendered: open the Tools tab and see the tool.
  // The tool inventory is a DataTable (SV6, commit f6ac558b — predates the def8205b baseline); each
  // tool's name cell is a labelled "Inspect <tool>" button, not a bare button named after the tool.
  await page.getByRole("tab", { name: /Tools 1/ }).click();
  await expect(page.getByRole("button", { name: "Inspect echo" })).toBeVisible();
  // The Overview KPI band carries the startup-token footprint for the scan (a real number, not "—").
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Startup tokens").first()).toBeVisible();

  // 5. Open a report: the export dialog → generate the (PDF/report-route) report → assert it renders.
  const exportButton = page.locator('button[aria-label="Export report"]');
  await expect(exportButton).toBeEnabled();
  await exportButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Export server report")).toBeVisible();
  // The default model roster seeds a selection once loaded, enabling generation (format defaults to PDF,
  // which routes to the in-app report view rather than the print dialog).
  const generate = dialog.getByRole("button", { name: "Generate report" });
  await expect(generate).toBeEnabled();
  await generate.click();

  // The report route (/reports/scans/:id) renders the compatibility & footprint report in the SPA.
  await expect(page).toHaveURL(/\/reports\/scans\//);
  await expect(page.getByText("MCP Server Compatibility & Footprint Report")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Echo E2E", level: 1 })).toBeVisible();
  await expect(page.getByText("Executive summary")).toBeVisible();
  // The scanned tool appears in the report's tool summary — proof the report reflects the real scan.
  await expect(page.getByText("echo", { exact: true }).first()).toBeVisible();
});

// WP 7.2 (Skill IDE) screenshot smoke: seed a blank skill (a version + slug come for free), open the
// version-scoped "Publish to GitHub" wizard from the inspector header, and capture it in BOTH themes.
// Evidence only (not a gate); the live publish itself needs a real PAT (owner-acceptance).
test("skill inspector → publish-to-GitHub wizard (both themes)", async ({ page, request }) => {
  const created = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "publish-wizard-smoke",
      displayName: "Publish Wizard Smoke",
      description: "A blank skill seeded for the WP 7.2 publish-to-GitHub wizard screenshot.",
    },
  });
  expect(created.ok(), `POST /api/skills failed: ${created.status()}`).toBeTruthy();
  const skill = (await created.json()) as { id: string; slug: string };
  expect(skill.id).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    // Force the theme (both the resolved-theme + preference keys), then reload so it applies pre-mount.
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    const publishButton = page.getByRole("button", { name: "Publish to GitHub" });
    await expect(publishButton).toBeVisible();
    await publishButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Publish to GitHub" })).toBeVisible();
    // The repo name is prefilled from the skill slug.
    await expect(dialog.getByLabel("Repository name")).toHaveValue(skill.slug);
    // The PAT field is a password input (never echoes the value).
    await expect(dialog.getByLabel("Personal access token")).toHaveAttribute("type", "password");

    // Let the Radix open-animation settle so the capture isn't a half-faded frame.
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/publish-wizard-${theme}.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  }
});

// WP 4.3 (Skill IDE) screenshot smoke: seed a blank skill, open the inspector's Quality tab, and
// capture the deterministic score + findings in BOTH themes. Evidence only (not a gate); a live
// apply-a-fix → new version → score-improves walk needs owner acceptance.
test("skill inspector → Quality tab (both themes)", async ({ page, request }) => {
  const created = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "quality-tab-smoke",
      displayName: "Quality Tab Smoke",
      description: "A blank skill seeded for the WP 4.3 Quality-tab screenshot.",
    },
  });
  expect(created.ok(), `POST /api/skills failed: ${created.status()}`).toBeTruthy();
  const skill = (await created.json()) as { id: string };
  expect(skill.id).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    // Force the theme (both the resolved-theme + preference keys), then reload so it applies pre-mount.
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    // Open the Quality tab (Overview · Design · Trace · Quality · Files · Versions · Diff).
    await page.getByRole("tab", { name: "Quality" }).click();

    // The deterministic score card renders once the quality report resolves.
    await expect(page.getByTestId("quality-score")).toBeVisible();
    await expect(page.getByText("Quality score")).toBeVisible();

    // Let any loading transitions settle so the capture isn't a half-rendered frame.
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/quality-tab-${theme}.png`, fullPage: true });
  }
});

// WP 8.2 (Skill IDE) screenshot smoke: seed an echo MCP server + a real scan, a blank skill bound to
// that server, then open the Files-tab SKILL.md editor and trigger the bound-tool completion widget
// (backtick context) in BOTH themes. Evidence only (not a gate); the API contract is locked by
// apps/api/test/skill-ide-bound-tools.test.ts. The completion popup capture is best-effort — the API
// bound-tools assertion is the deterministic proof.
test("skill editor → bound-tool completion from a bound server's scan (both themes)", async ({
  page,
  request,
}) => {
  const serverName = "Bound Echo";
  const createdServer = await request.post("/api/servers", {
    data: { name: serverName, transport: "stdio", command: "node", args: [echoServer] },
  });
  expect(createdServer.ok(), `POST /api/servers failed: ${createdServer.status()}`).toBeTruthy();
  const server = (await createdServer.json()) as { id: string };

  // Run a real scan (the POST awaits discovery) so the server has a completed scan to read tools from.
  const scanned = await request.post(`/api/servers/${server.id}/scan`, { data: {} });
  expect(scanned.ok(), `scan failed: ${scanned.status()}`).toBeTruthy();

  const createdSkill = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "bound-tools-smoke",
      displayName: "Bound Tools Smoke",
      description: "A blank skill bound to the echo server for the WP 8.2 completion screenshot.",
    },
  });
  expect(createdSkill.ok(), `POST /api/skills failed: ${createdSkill.status()}`).toBeTruthy();
  const skill = (await createdSkill.json()) as { id: string };

  // Bind the skill to the scanned server (a persisted binding — no frontmatter needed).
  const bound = await request.put(`/api/skills/${skill.id}/bindings`, {
    data: { bindings: [{ serverName, serverId: server.id }] },
  });
  expect(bound.ok(), `PUT bindings failed: ${bound.status()}`).toBeTruthy();

  // Deterministic proof the surface is wired: the bound-tools route returns the echo server's tool.
  const version = (await (await request.get(`/api/skills/${skill.id}`)).json()) as {
    currentVersionId: string;
  };
  const boundTools = (await (
    await request.get(`/api/skills/${skill.id}/versions/${version.currentVersionId}/bound-tools`)
  ).json()) as Array<{ toolName: string; serverName: string; definitionTokens: number }>;
  expect(boundTools.some((t) => t.toolName === "echo")).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    // Open the Files tab and its SKILL.md editor.
    await page.getByRole("tab", { name: "Files" }).click();
    await page.getByText("SKILL.md", { exact: true }).first().click();
    const editor = page.locator(".monaco-editor").first();
    await expect(editor).toBeVisible();

    // Trigger the completion widget from a backtick context: click into the editor, jump to the end,
    // and type an inline-code prefix. Best-effort — tolerate the popup not settling in the capture.
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\nCall `ec");
    await page
      .locator(".monaco-editor .suggest-widget")
      .waitFor({ state: "visible", timeout: 6000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/bound-tools-completion-${theme}.png` });
  }
});

// WP 8.3 (Skill IDE) screenshot smoke: seed + scan the echo stdio server, a blank skill bound to it,
// add a tool reference (so a `tool_ref` node + detail card exist), then open the Design tab and
// capture the Tools palette (per-server groups, per-tool token cost, the referenced tool-surface
// footprint readout) + the tool-reference detail card in BOTH themes. Evidence only (not a gate); the
// add_tool_ref round-trip is deterministically locked by apps/api/test/skill-ide-roundtrip.test.ts.
// The five "skill design →" tests below drive the skill inspector's DESIGN tab, which is
// intentionally PARKED (owner decision O2b — SkillInspector.tsx hides the Design + Trace tabs; the
// live editor is the Files tab). They fail at `getByRole("tab",{name:"Design"})` because that tab is
// deliberately absent, and they were already red before the design-remediation programme (the parking
// commit f5e1ea67 predates the remediation baseline; SkillInspector.tsx has zero diff in range).
// Skipped-with-reason rather than left as hard failures — un-park the Design tab to re-enable.
test.skip("skill design → Tools palette + tool_ref detail card (both themes)", async ({
  page,
  request,
}) => {
  const serverName = "Palette Echo";
  const createdServer = await request.post("/api/servers", {
    data: { name: serverName, transport: "stdio", command: "node", args: [echoServer] },
  });
  expect(createdServer.ok(), `POST /api/servers failed: ${createdServer.status()}`).toBeTruthy();
  const server = (await createdServer.json()) as { id: string };

  const scanned = await request.post(`/api/servers/${server.id}/scan`, { data: {} });
  expect(scanned.ok(), `scan failed: ${scanned.status()}`).toBeTruthy();

  const createdSkill = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "tools-palette-smoke",
      displayName: "Tools Palette Smoke",
      description:
        "A blank skill bound to the echo server for the WP 8.3 palette + tool-card screenshot.",
    },
  });
  expect(createdSkill.ok(), `POST /api/skills failed: ${createdSkill.status()}`).toBeTruthy();
  const skill = (await createdSkill.json()) as { id: string; currentVersionId: string };

  const bound = await request.put(`/api/skills/${skill.id}/bindings`, {
    data: { bindings: [{ serverName, serverId: server.id }] },
  });
  expect(bound.ok(), `PUT bindings failed: ${bound.status()}`).toBeTruthy();

  // Stage a tool reference (a snake_case name so it re-projects as a `tool_ref` node) onto the blank
  // skill's one section, creating a v2 whose graph carries the tool_ref for the detail-card capture.
  const graphRes = await request.get(
    `/api/skills/${skill.id}/versions/${skill.currentVersionId}/graph`,
  );
  const { graph } = (await graphRes.json()) as {
    graph: { nodes: Array<{ id: string; kind: string }> };
  };
  const sectionId = graph.nodes.find((n) => n.kind === "subroutine")?.id;
  expect(sectionId, "blank skill has a section node").toBeTruthy();
  const versionRes = await request.get(
    `/api/skills/${skill.id}/versions/${skill.currentVersionId}`,
  );
  const { treeSha } = (await versionRes.json()) as { treeSha: string };
  const edited = await request.post(
    `/api/skills/${skill.id}/versions/${skill.currentVersionId}/edits`,
    {
      data: {
        baseTreeSha: treeSha,
        ops: [{ op: "add_tool_ref", nodeId: sectionId, server: serverName, tool: "list_items" }],
      },
    },
  );
  expect(edited.ok(), `POST edits failed: ${edited.status()}`).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    await page.getByRole("tab", { name: "Design" }).click();
    // Turn on edit mode so the palette shows its drag/insert affordances (it renders in both modes).
    await page.getByLabel("Edit mode").click();

    // The Tools palette: the footprint readout + the bound echo tool with its definition token cost.
    await expect(page.getByText("Referenced tool-surface footprint")).toBeVisible();
    await expect(page.getByText("echo", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/tools-palette-${theme}.png` });

    // Best-effort: click the `list_items` tool_ref node on the canvas → its detail card (Unbound —
    // no bound, scanned server exposes it). Tolerate the canvas node not being hit in the capture.
    await page
      .getByText("list_items", { exact: true })
      .first()
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/tool-ref-card-${theme}.png` });
  }
});

// WP 8.4 (Skill IDE) screenshot smoke: seed + scan the echo stdio server, open the Skills view's
// "New skill from server…" wizard, drive it to the tool multi-select step (a DataTable with per-tool
// token costs), and capture BOTH themes. Evidence only (not a gate); the created-skill → Design-tab
// walk needs owner acceptance.
test("skills → New skill from server wizard (both themes)", async ({ page, request }) => {
  const serverName = "Scaffold Source E2E";
  const createdServer = await request.post("/api/servers", {
    data: { name: serverName, transport: "stdio", command: "node", args: [echoServer] },
  });
  expect(createdServer.ok(), `POST /api/servers failed: ${createdServer.status()}`).toBeTruthy();
  const server = (await createdServer.json()) as { id: string };

  // A real scan gives the server a completed scan → it becomes an eligible scaffold source.
  const scanned = await request.post(`/api/servers/${server.id}/scan`, { data: {} });
  expect(scanned.ok(), `scan failed: ${scanned.status()}`).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto("/skills");
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    // D-UX1 / K6 (commit 38992f6e — predates the def8205b remediation baseline): "New skill from
    // server" is no longer a standalone button; it is the 4th "From server" source tile in the
    // Add-skill modal, which hands off to the dedicated scaffold wizard (App.tsx `openScaffoldFromServer`
    // closes the Add-skill modal and opens `ScaffoldFromServerWizard`). Drive that real entry point.
    // Both the skills rail and the empty state expose an "Add skill" button — either opens the modal.
    await page.getByRole("button", { name: "Add skill" }).first().click();
    const addSkill = page.getByRole("dialog");
    await expect(addSkill.getByRole("heading", { name: "Add skill" })).toBeVisible();
    // The source picker is a type="single" ToggleGroup (items are role="radio"); pick "From server"
    // and Continue → the Add-skill modal closes and the scaffold wizard opens.
    await addSkill.getByRole("radio", { name: "From server" }).click();
    await addSkill.getByRole("button", { name: "Continue" }).click();

    // The dedicated scaffold wizard. Its title carries the server-types "or type" bind option
    // (server-types WP3.2). Scope to it explicitly so the Add-skill modal's close animation cannot
    // race the locators below.
    const dialog = page.getByRole("dialog").filter({ hasText: "New skill from server or type" });
    await expect(
      dialog.getByRole("heading", { name: "New skill from server or type" }),
    ).toBeVisible();

    // Step 1 — the "A server" bind-kind is the default; pick the scanned server, then Continue.
    await dialog.getByRole("button", { name: new RegExp(serverName) }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();

    // Step 2 — the tool DataTable renders the echo tool with its token cost.
    await expect(dialog.getByText("echo", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/scaffold-from-server-${theme}.png` });

    await dialog.getByRole("button", { name: "Cancel" }).click();
    // Cancelling with a server chosen prompts the discard guard — confirm to close.
    await page
      .getByRole("button", { name: /Discard/ })
      .click()
      .catch(() => {});
  }
});

// WP 8.5 (Skill IDE) screenshot smoke: seed + scan the echo stdio server, a blank skill bound to it,
// then reference a tool the server does NOT expose (`list_items` — snake_case so it PROJECTS as a
// tool_ref node) so the Design tab's tool-card renders the inline tool-runner's UNBOUND, DISABLED
// "Test run" affordance — the WP 8.5 rule that an unresolved binding never yields a broken run.
// Captured in BOTH themes. Evidence only (not a gate).
//
// Honest scope: the RESOLVED-card → runner-Sheet → run → result walk needs a bound server whose tool
// name projects as a tool_ref (snake_case/namespaced) so its card exposes an ENABLED "Test run"; the
// echo fixture's single bare-word `echo` tool can't project one (the extraction heuristic needs a
// separator), so that live walk is owner-acceptance. The extracted `ToolRunner` is regression-locked
// by typecheck (the scans playground consumes it unchanged) and the API tool-call route is unchanged.
// Parked Design tab (O2b) — see the note above the Tools-palette test.
test.skip("skill design → inline tool-runner unbound disabled state (both themes)", async ({
  page,
  request,
}) => {
  const serverName = "Runner Echo";
  const createdServer = await request.post("/api/servers", {
    data: { name: serverName, transport: "stdio", command: "node", args: [echoServer] },
  });
  expect(createdServer.ok(), `POST /api/servers failed: ${createdServer.status()}`).toBeTruthy();
  const server = (await createdServer.json()) as { id: string };

  const scanned = await request.post(`/api/servers/${server.id}/scan`, { data: {} });
  expect(scanned.ok(), `scan failed: ${scanned.status()}`).toBeTruthy();

  const createdSkill = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "tool-runner-smoke",
      displayName: "Tool Runner Smoke",
      description:
        "A blank skill bound to the echo server for the WP 8.5 inline tool-runner screenshot.",
    },
  });
  expect(createdSkill.ok(), `POST /api/skills failed: ${createdSkill.status()}`).toBeTruthy();
  const skill = (await createdSkill.json()) as { id: string; currentVersionId: string };

  const bound = await request.put(`/api/skills/${skill.id}/bindings`, {
    data: { bindings: [{ serverName, serverId: server.id }] },
  });
  expect(bound.ok(), `PUT bindings failed: ${bound.status()}`).toBeTruthy();

  // Stage an UNBOUND snake_case tool reference (`list_items`) onto the blank skill's one section →
  // v2's graph carries a tool_ref that resolves to nothing → its card shows the disabled Test-run.
  const graphRes = await request.get(
    `/api/skills/${skill.id}/versions/${skill.currentVersionId}/graph`,
  );
  const { graph } = (await graphRes.json()) as {
    graph: { nodes: Array<{ id: string; kind: string }> };
  };
  const sectionId = graph.nodes.find((n) => n.kind === "subroutine")?.id;
  expect(sectionId, "blank skill has a section node").toBeTruthy();
  const versionRes = await request.get(
    `/api/skills/${skill.id}/versions/${skill.currentVersionId}`,
  );
  const { treeSha } = (await versionRes.json()) as { treeSha: string };
  const edited = await request.post(
    `/api/skills/${skill.id}/versions/${skill.currentVersionId}/edits`,
    {
      data: {
        baseTreeSha: treeSha,
        ops: [{ op: "add_tool_ref", nodeId: sectionId, server: serverName, tool: "list_items" }],
      },
    },
  );
  expect(edited.ok(), `POST edits failed: ${edited.status()}`).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    await page.getByRole("tab", { name: "Design" }).click();
    // The bound echo tool appears in the palette — a reliable proof the binding + scan are wired.
    await expect(page.getByText("echo", { exact: true }).first()).toBeVisible();

    // Best-effort: click the `list_items` tool_ref node on the canvas → its detail card, which now
    // carries the WP 8.5 disabled "Test run" affordance (Unbound — no scanned server exposes it).
    await page
      .getByText("list_items", { exact: true })
      .first()
      .click({ timeout: 4000 })
      .catch(() => {});
    await page
      .getByRole("button", { name: "Test run" })
      .first()
      .waitFor({ state: "visible", timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/tool-runner-unbound-${theme}.png` });
  }
});

// WP 9.2 (Skill IDE) screenshot smoke: seed a blank skill, enrich its SKILL.md (via the content-canonical
// save-draft) with a main flow + a `/report` command flow, then drive the unified editor's Flow | Code |
// Split segmented control and capture all three modes in BOTH themes. Evidence only (not a gate) — the
// live flow↔code round trip, split selection sync, and no-Monaco-double-mount are behavior claims verified
// against the running app.
// Parked Design tab (O2b) — see the note above the Tools-palette test.
test.skip("skill design → unified editor Flow | Code | Split (both themes)", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "unified-editor-smoke",
      displayName: "Unified Editor Smoke",
      description: "A skill seeded for the WP 9.2 unified-editor screenshots.",
    },
  });
  expect(created.ok(), `POST /api/skills failed: ${created.status()}`).toBeTruthy();
  const skill = (await created.json()) as { id: string; currentVersionId: string };
  expect(skill.id).toBeTruthy();

  // Enrich SKILL.md so the flow view has a body flow AND a `/report` command flow (two lanes), and the
  // code view has real content to edit — through the same content-canonical save-draft the UI uses.
  const skillMd = [
    "---",
    "name: unified-editor-smoke",
    "description: A skill seeded for the WP 9.2 unified-editor screenshots.",
    "---",
    "",
    "# Unified Editor Smoke",
    "",
    "Steps for the demo skill.",
    "",
    "## Gather inputs",
    "",
    "Collect the inputs needed to build the report.",
    "",
    "## /report",
    "",
    "Generate the report from the gathered inputs.",
    "",
    "## Format output",
    "",
    "Format the final result for the user.",
    "",
  ].join("\n");
  const saved = await request.post(`/api/skills/${skill.id}/save-draft`, {
    data: { baseVersionId: skill.currentVersionId, content: skillMd, treeOps: [], intentLog: [] },
  });
  expect(saved.ok(), `save-draft failed: ${saved.status()}`).toBeTruthy();

  const flow = page.locator('[aria-label="Show flow"]');
  const code = page.locator('[aria-label="Show code"]');
  const split = page.locator('[aria-label="Split view"]');

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    // Force the theme (resolved + preference keys), then reload so it applies pre-mount.
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    await page.getByRole("tab", { name: "Design" }).click();

    // Flow (the default). The segmented control + the canvas legend prove the unified editor loaded.
    await expect(flow).toBeVisible();
    await flow.click();
    await expect(page.getByText("Node kinds")).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/unified-flow-${theme}.png` });

    // Code — the full-document Monaco editor bound to the draft.
    await code.click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/unified-code-${theme}.png` });

    // Split — canvas + code side by side (resizable), selection synced both ways.
    await split.click();
    await expect(page.getByText("Node kinds")).toBeVisible();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/unified-split-${theme}.png` });
  }
});

// WP 9.3 (Skill IDE) screenshot smoke: seed a skill rich in code-mode constructs (two /command flows,
// an annotated gatekeeper with a breadcrumb marker, a backticked tool reference), open the Design tab's
// Code view, and capture the decoration set (kind gutter glyphs, per-flow rails, annotation/breadcrumb
// markers, the tool-reference underline) + a construct hover in BOTH themes. Evidence only (not a gate);
// the deterministic proof is apps/api/test/skill-ide-snippets.test.ts (snippet → project-preview → kind).
// Parked Design tab (O2b) — see the note above the Tools-palette test.
test.skip("skill design → code-mode decorations + construct hover (both themes)", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "code-intel-smoke",
      displayName: "Code Intel Smoke",
      description: "A skill seeded for the WP 9.3 code-mode intelligence screenshots.",
    },
  });
  expect(created.ok(), `POST /api/skills failed: ${created.status()}`).toBeTruthy();
  const skill = (await created.json()) as { id: string; currentVersionId: string };
  expect(skill.id).toBeTruthy();

  // A body flow + two /command flows, an annotated gatekeeper with a breadcrumb marker, and a tool
  // reference — one of every code-mode construct the decorations + hovers cover.
  const skillMd = [
    "---",
    "name: code-intel-smoke",
    "description: A skill seeded for the WP 9.3 code-mode intelligence screenshots.",
    "keywords:",
    "  - analyze export",
    "  - daily report",
    "---",
    "",
    "# Code Intel Smoke",
    "",
    "Exercises the code-mode decorations and hovers.",
    "",
    "## /analyze",
    "",
    "Run the analysis pipeline over the user's export.",
    "",
    "<!-- skillflow:gatekeeper id=route-input -->",
    "## Route the input",
    "",
    "If the input is CSV, parse it with the header convention. Otherwise, parse it as JSON.",
    "",
    "Emit `[skillflow:gate=route-input route=r-csv]` naming the branch you took.",
    "",
    "## /report daily",
    "",
    "Call the `acme_create_data_object` tool to persist the report.",
    "",
  ].join("\n");
  const saved = await request.post(`/api/skills/${skill.id}/save-draft`, {
    data: { baseVersionId: skill.currentVersionId, content: skillMd, treeOps: [], intentLog: [] },
  });
  expect(saved.ok(), `save-draft failed: ${saved.status()}`).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    // Force the theme (resolved + preference keys), then reload so it applies pre-mount.
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    await page.getByRole("tab", { name: "Design" }).click();
    await page.locator('[aria-label="Show code"]').click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    // Let the debounced project-preview land so decorations (from the live projection) are computed.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/code-intel-${theme}.png` });

    // Best-effort construct hover on the `## /analyze` heading (evidence, not a gate assertion).
    const line = page.locator(".view-line", { hasText: "/analyze" }).first();
    const box = await line.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.move(box.x + 45, box.y + box.height / 2);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `test-results/code-intel-hover-${theme}.png` });
    }
  }
});

// WP 9.4 (Skill IDE) screenshot smoke: seed a skill whose SKILL.md yields a LIVE projector warning (a
// gatekeeper section whose branch targets don't resolve to sections), open the Design tab, and capture
// the unified education layer — the problems panel (Flow AND Code, proving it renders identically), the
// canvas explainer legend popover, and a node's "What is this?". BOTH themes. Evidence only (not a
// gate); the deterministic proof is apps/api/test/skill-ide-explainers.test.ts.
// Parked Design tab (O2b) — see the note above the Tools-palette test.
test.skip("skill design → education layer: problems panel + legend + what-is-this (both themes)", async ({
  page,
  request,
}) => {
  // This walk drives many surfaces (panel expand + legend popover + node select + Flow→Code) across
  // BOTH themes, so it needs more than the default 60s budget.
  test.setTimeout(150_000);
  const created = await request.post("/api/skills", {
    data: {
      source: "blank",
      name: "education-layer-smoke",
      displayName: "Education Layer Smoke",
      description:
        "A skill seeded for the WP 9.4 education-layer screenshots (problems panel + legend).",
    },
  });
  expect(created.ok(), `POST /api/skills failed: ${created.status()}`).toBeTruthy();
  const skill = (await created.json()) as { id: string; currentVersionId: string };
  expect(skill.id).toBeTruthy();

  // A gatekeeper section with branch prose whose targets don't resolve to sections → the projector
  // emits a LIVE `gatekeeper "…" branch targets are not resolvable …` warning the panel surfaces.
  const skillMd = [
    "---",
    "name: education-layer-smoke",
    "description: A skill seeded for the WP 9.4 education-layer screenshots (problems panel + legend).",
    "---",
    "",
    "# Education Layer Smoke",
    "",
    "Steps for the demo skill.",
    "",
    "## Route the input",
    "",
    "If the input is CSV, take the fast path. Otherwise, take the slow path.",
    "",
    "## Format output",
    "",
    "Format the final result for the user.",
    "",
  ].join("\n");
  const saved = await request.post(`/api/skills/${skill.id}/save-draft`, {
    data: { baseVersionId: skill.currentVersionId, content: skillMd, treeOps: [], intentLog: [] },
  });
  expect(saved.ok(), `save-draft failed: ${saved.status()}`).toBeTruthy();

  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/skills/${skill.id}`);
    await page.evaluate((t) => {
      localStorage.setItem("brand-ui-theme", t);
      localStorage.setItem("mcp-token-footprint.theme-preference", t);
    }, theme);
    await page.reload();

    await page.getByRole("tab", { name: "Design" }).click();

    // Flow mode (the default). The problems panel is mounted below the body in every mode.
    await expect(page.locator('[data-testid="problems-panel"]')).toBeVisible();
    // Let the debounced project-preview + the persisted quality/tool fetches land.
    await page.waitForTimeout(1000);

    // Best-effort: select a canvas node → the node panel's "What is this?" teaching card. Done FIRST
    // (in a clean flow state) so its capture never depends on a prior popover's teardown.
    const node = page.locator(".react-flow__node").first();
    if (await node.count()) {
      await node.click({ force: true }).catch(() => {});
      const whatIsThis = page.locator('[data-testid="what-is-this"]').first();
      if (
        await whatIsThis
          .waitFor({ state: "visible", timeout: 4000 })
          .then(() => true)
          .catch(() => false)
      ) {
        await page.screenshot({ path: `test-results/what-is-this-${theme}.png` });
      }
    }

    // Expand the problems panel and capture it in Flow mode (the live projector warning shows here).
    await page
      .getByRole("button", { name: /Problems/ })
      .first()
      .click();
    await expect(page.locator('[data-testid="problems-list"]')).toBeVisible();
    await page.screenshot({ path: `test-results/problems-flow-${theme}.png` });

    // The graph legend popover (unified-editor toolbar) — every node/edge kind with its explainer +
    // guide anchor. Its aria-label is the accessible name; the visible text is "Legend".
    await page.getByRole("button", { name: "What the node and edge kinds mean" }).click();
    await expect(page.getByText("What the graph means")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/legend-${theme}.png` });
    // Close the popover deterministically before touching the toolbar again (Escape restores trigger
    // focus; assert it's gone so it can never intercept the next click).
    await page.keyboard.press("Escape");
    await expect(page.getByText("What the graph means")).toBeHidden();

    // Switch to Code mode — the SAME problems panel must still render (identical in both modes).
    await page.locator('[aria-label="Show code"]').click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await expect(page.locator('[data-testid="problems-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="problems-list"]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/problems-code-${theme}.png` });
  }
});

// ── Unified Sessions (roadmap/unified-sessions/, WP3.R) — seeded session-state review ──────────────
//
// Seeds one persisted run per (backend kind × session state) DIRECTLY into the built API's SQLite via
// the SAME reusable harness the WP3.R conformance test proves (`apps/api/scripts/seed-sessions.ts` →
// `seedSessionGrid`), then drives the three WP3.R affordances through the real UI: the Runs feed's
// **Needs attention** section, the **End session** confirm flow, and the **stream reconnect banner**.
// NO provider key / NO live LLM — the findings/08 verification pattern.
//
// Honest scope: the End-session HAPPY PATH (confirm → the run transitions to `ended`) needs a genuinely
// LIVE interactive session (a real engine turn), which needs a provider key — that transition is proven
// at the API level by `apps/api/test/run-session-lifecycle.test.ts` and is owner-acceptance in the app.
// Here a seeded interactive run is "live" (status `running`) but has NO in-memory session, so `/end`
// answers 409 ("not live") — which is exactly what lets this same walk ALSO surface the reconnect banner
// (the persisted-replay stream closes with no terminal status → the client shows "connection lost").
test.describe("Unified Sessions (WP3.R) — seeded session states", () => {
  test.beforeAll(async () => {
    const dataDir = process.env.E2E_DATA_DIR;
    if (!dataDir) throw new Error("E2E_DATA_DIR not set by playwright.config.ts");
    // Seed the SAME SQLite the built API serves, using the REUSABLE harness directly (WAL — the idle API
    // and this one-shot writer coexist). `better-sqlite3` is a dep of `apps/api` (not hoisted to the repo
    // root where this e2e file resolves), so require it from there; the harness (a `.ts` under
    // `apps/api/test`) is dynamic-imported so a resolution issue only touches this block. `INSERT OR
    // REPLACE` by fixed id, so re-running is safe.
    const apiRequire = createRequire(path.resolve(rootDir, "apps", "api", "package.json"));
    const Database = apiRequire("better-sqlite3") as typeof import("better-sqlite3");
    const { seedSessionGrid } = await import("../apps/api/test/support/session-seed-grid.js");
    const db = new Database(path.join(dataDir, "app.sqlite"));
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    try {
      seedSessionGrid(db);
    } finally {
      db.close();
    }
  });

  test("runs feed → Needs attention section renders locked-table session chips (both themes)", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.goto("/testing/runs");
      await page.evaluate((t) => {
        localStorage.setItem("brand-ui-theme", t);
        localStorage.setItem("mcp-token-footprint.theme-preference", t);
      }, theme);
      await page.reload();

      // The seeded attention-worthy runs surface in the runs feed's dense table with their
      // LOCKED-TABLE labels — the substantive point of this walk (D-US5 conformance). The former
      // "Needs attention" section CARD was removed in favour of a filterable property (commit
      // 490a9dda, owner-requested — this predates the def8205b remediation baseline; the dense table
      // is now the primary, unobstructed view), so this walk asserts the locked-table chips in the
      // table (where the test's own comments already noted they render) instead of a section header.
      //
      // A live-attention chip (locked table: `running` + `waiting_input` → "Waiting for you"). The
      // WP3.fix D-US5 sweep made the main table's `RunTableRow` render the locked table (the row bridge
      // threads `phase`/`stopReasonCode` into `deriveRunStatusView`).
      await expect(page.getByText("Waiting for you").first()).toBeVisible();
      // A terminal locked-table label the pre-WP3.fix coarse bridge would NOT produce ("Stopped — stalled"
      // for `stalled`; the un-widened bridge rendered the generic "Stopped (guardrail)"). Its presence in
      // the main table proves the run-status surfaces render the locked table.
      await expect(page.getByText("Stopped — stalled").first()).toBeVisible();
      // "Needs attention" survives as a FILTER, not a section: it is an option in the "+ Filter" menu
      // (design-remediation T8 reshaped the run filter bar — `RunFilterBar.tsx` FIELD_GROUPS "Other").
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Needs attention" })).toBeVisible();
      await page.keyboard.press("Escape");

      await page.waitForTimeout(300);
      await page.screenshot({
        path: `test-results/wp3r-needs-attention-${theme}.png`,
        fullPage: true,
      });
    }
  });

  test("run console → an `ended` session renders the locked 'Ended' chip (both themes)", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.goto("/testing/runs/us-engine-ended");
      await page.evaluate((t) => {
        localStorage.setItem("brand-ui-theme", t);
        localStorage.setItem("mcp-token-footprint.theme-preference", t);
      }, theme);
      await page.reload();

      // The console header badge renders the D-US2 terminal via the locked table: "Ended" (green), not a
      // fake "Completed"/"Aborted". A finished run is replay/locked — no Stop/End controls.
      await expect(page.getByText("Ended").first()).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `test-results/wp3r-ended-console-${theme}.png`,
        fullPage: true,
      });
    }
  });

  test("run console → End session confirm dialog on a live interactive session", async ({
    page,
  }) => {
    // A seeded interactive `waiting_input` run is live → the header shows "Waiting for you" + End session.
    await page.goto("/testing/runs/us-engine-waiting_input");
    await expect(page.getByText("Waiting for you").first()).toBeVisible();

    const endButton = page.getByRole("button", { name: "End session" });
    await expect(endButton).toBeVisible();
    await endButton.click();

    // The confirm dialog (mirrors the Stop dialog shape). Confirming a seeded (non-live) run answers 409
    // "not live" — the server reason surfaces in a toast; the ACTUAL confirm → `ended` transition needs a
    // real live session (owner-acceptance; API-covered by run-session-lifecycle.test.ts).
    await expect(page.getByText("End this session?")).toBeVisible();
    await page.screenshot({ path: "test-results/wp3r-end-session-confirm.png" });
    // Close the dialog without asserting the transition (no live session to end).
    await page.getByRole("button", { name: "Keep going" }).click();
  });

  test("run console → stream reconnect banner surfaces when the live stream drops", async ({
    page,
  }) => {
    // Opening a seeded `running` run whose stream has no active emitter closes the socket with no terminal
    // status → the client surfaces the SAME "connection lost" banner the 45s watchdog (WP2.2) surfaces
    // (both set the one CONNECTION_LOST sentinel; the watchdog's 45s-silence path is unit-covered by
    // apps/api/test/run-stream-routes.test.ts + the WP2.R client probes).
    await page.goto("/testing/runs/us-engine-waiting_input");
    await expect(page.getByRole("heading", { name: "Run stream connection lost" })).toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot({ path: "test-results/wp3r-reconnect-banner.png" });
  });
});

/**
 * Opens the hub's "New session" dialog on `/assistant`, working from EITHER of its two real entry
 * points depending on whether a session already exists in this browsing context:
 *   - No session yet: `AssistantView`'s no-session `EmptyState` renders an EXACT "New session" button
 *     (`AssistantView.tsx`'s `emptyIntroContent`) — the only "New…" affordance on this route.
 *   - A session is already active (the common case for every WP4.1 flow below, since earlier tests in
 *     this same describe/file already created hub sessions and `AssistantView` auto-selects the most
 *     recently active one on load): the EmptyState never renders, so the way in is the breadcrumb
 *     session switcher (`SessionBreadcrumbSwitcher.tsx`) — open its Popover and click the footer
 *     "New session" button.
 * (There is NO exact-"New" button on this route at all — that one lives on `/assistant/agents`.)
 *
 * Locator notes:
 *   - The toolbar `SessionSwitcher` Combobox was replaced by the breadcrumb `SessionBreadcrumbSwitcher`
 *     (commit b122246a — predates the def8205b remediation baseline). Its trigger is a `Popover`
 *     `Button` whose accessible name is its `aria-label="Switch session"`; the old `[role="combobox"]`
 *     raw-attribute selector no longer finds it (and T9's accessibility wiring gave the composer
 *     `MentionEditor` a real `role="combobox"`, so that selector would now wrongly resolve to the
 *     composer). Open the popover, then click its footer "New session" button (scoped to the popover's
 *     `data-testid` so it can't collide with the nav's "New session" LINK).
 *   - Right after `page.goto`, the app is still resolving the hub-eligible credential + session list
 *     (an async settle), so an INSTANT `isVisible()` check can race-lose against both candidates —
 *     wait for either to actually appear before deciding which branch applies.
 */
async function openNewSessionDialog(page: Page): Promise<void> {
  const emptyStateButton = page.getByRole("button", { name: "New session", exact: true });
  const sessionSwitcher = page.getByRole("button", { name: "Switch session" });
  await Promise.race([
    emptyStateButton.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
    sessionSwitcher.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
  ]);
  if (await emptyStateButton.isVisible().catch(() => false)) {
    await emptyStateButton.click();
    return;
  }
  await sessionSwitcher.click();
  await page
    .getByTestId("session-switcher-popover")
    .getByRole("button", { name: "New session" })
    .click();
}

// ── Assistant Hub (roadmap/assistant-hub/, WP4.4 + WP4.1) — stubbed-model e2e flows ─────────────────
//
// Drives the REAL hub engine (turn-engine's `streamText` tool loop; the mission planner/agent-runner/
// synthesizer's `generateObject`/`generateText` calls) against a deterministic in-process stub model
// (an `openai_compatible` credential pointed at `hub-stub-llm-server.ts`, started fresh per test — no
// real network call is ever made; see that file's module doc for the discrimination strategy). WP4.4's
// original test proves the flagship showcase end-to-end: open Assistant → a chat message drives the
// model to call the `artifacts.create` built-in (an artifact appears in the canvas) → a mission session
// proposes a plan (the planner's structured output) → approving it spawns the child agent, collects its
// structured report, and synthesizes a final cited answer — the mission board settles "Complete". The
// WP4.1 tests below REUSE this same `stub` server (registering their own additional `openai_compatible`
// credentials pointed at the SAME live `stub.url` — harmless: `useHubModelRoster` dedupes by model id,
// and `createHubModelResolver`'s `pool[0]` fallback still only ever reaches this one live process) to
// cover first-prompt choreography (D-HUX13, incl. the WP1.R-A reduced-motion regression), the meta
// rail's Progress/Outputs sections, the Sessions table → workspace hop, workforce quick-create → Access
// grant → Org chart/Usage tabs, and a Usage-tab drill back into a filtered Sessions view.
test.describe("Assistant Hub (WP4.4 + WP4.1) — stubbed-model smoke", () => {
  // The default `devices["Desktop Chrome"]` viewport (1280px) is narrower than the workspace's own
  // meta-rail Sheet breakpoint (`META_RAIL_SHEET_BREAKPOINT_PX` 1100 + `META_RAIL_WIDTH_PX` 360 =
  // 1460px, `lib/hub-ux.ts`) — and `AssistantView`'s `metaRailVisible` starts `true`, so at the
  // default viewport `MetaRail` mounts as an ALREADY-OPEN modal `Sheet` whose full-screen backdrop
  // (`fixed inset-0 z-50 ...`) intercepts pointer events for the REST of the page (confirmed against
  // a real Chromium run — every click on the toolbar/composer timed out "element intercepts pointer
  // events" until this was widened). A real desktop user of this feature sees the inline (non-Sheet)
  // rail; widen the viewport so these flows do too, instead of fighting a modal that only exists as
  // an artifact of the CI-standard viewport size.
  test.use({ viewport: { width: 1600, height: 900 } });

  let stub: HubStubLlmServer;

  test.beforeAll(async () => {
    stub = await startHubStubLlmServer();
  });

  test.afterAll(async () => {
    await stub.close();
  });

  test("chat message creates an artifact; a mission is proposed, approved, and synthesizes", async ({
    page,
    request,
  }) => {
    // This walk makes several real round trips (propose → approve → spawn → report → synthesize),
    // each against the local stub server, but still comfortably needs more than the default 60s.
    test.setTimeout(120_000);

    // Register the deterministic `openai_compatible` credential the hub's model roster resolves to
    // (the ONLY hub-eligible credential in this run, so `createHubModelResolver` always picks it —
    // see the fixture's module doc).
    const created = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: "E2E Stub Model",
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(created.ok(), `POST /api/providers failed: ${created.status()}`).toBeTruthy();

    await page.goto("/assistant");
    // The page's own H1 ("Assistant") is intentionally `sr-only` (AT-only — page identity comes from
    // the AppShell breadcrumb per D-HUX2) — verified against a real Chromium run: a standard
    // `clip-path: inset(50%)` 1x1px sr-only element like this one falls out of Chromium's REAL
    // computed accessibility tree entirely (unlike the debug ARIA-snapshot tool, which reads more
    // leniently and still shows it), so `getByRole("heading", …)` never matches it at all — not even
    // via `toBeAttached()`. A raw tag locator sidesteps role computation and reliably finds it.
    await expect(page.locator("h1", { hasText: "Assistant" })).toBeAttached();

    // ── 1. Chat session: a message drives the stubbed model to call `artifacts.create` ────────────
    // No sessions exist yet in this run — `openNewSessionDialog` takes the no-session EmptyState's
    // "New session" button (see that helper's doc for why this isn't a bare exact-"New" match).
    await openNewSessionDialog(page);
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New session" })).toBeVisible();
    // The model roster (`GET /api/providers/:id/models` → this stub's `GET /v1/models`) must resolve
    // before "Start session" enables (it auto-selects the roster's one model).
    const startButton = dialog.getByRole("button", { name: "Start session" });
    await expect(startButton).toBeEnabled({ timeout: 15_000 });
    await startButton.click();
    await expect(dialog).toBeHidden();

    // The composer is a contenteditable `MentionEditor` whose placeholder is rendered as an
    // `aria-hidden` span (no `placeholder`/`aria-placeholder` attribute), so `getByPlaceholder(/ask the
    // assistant/i)` never matched it — even at the def8205b baseline. Target its stable `data-testid`
    // instead (the same handle T9's `focusComposer` uses); `fill()` works on `[contenteditable]`.
    const composer = page.getByTestId("mention-editor");
    await composer.fill(HUB_E2E_ARTIFACT_MESSAGE);
    // The Composer's send control is `@elabs-ai/components-ai` `PromptInputSubmit`, whose accessible name is "Send
    // message" (not "Submit") — this predates the def8205b baseline (Composer.tsx's send button is
    // unchanged by the remediation).
    await page.getByRole("button", { name: "Send message" }).click();

    // The tool ran mid-turn (built-ins are always auto-eligible — no approval card) and the turn
    // settled with the stub's confirmation text.
    await expect(page.getByText(HUB_E2E_ARTIFACT_REPLY)).toBeVisible({ timeout: 20_000 });

    // The artifact the tool call created surfaces in the meta rail's Outputs section (D-HUX3). The
    // former "Show artifacts"/"Hide artifacts" canvas toggle was removed in the assistant-hub-ux
    // rebuild (commit c4b94e73 — predates the def8205b baseline). At this wide (1600px) viewport the
    // rail renders INLINE (`aria-label="Session meta rail"`) and its Outputs header keeps a live count.
    const metaRail = page.getByLabel("Session meta rail");
    const outputsTrigger = metaRail.getByRole("button", { name: /Outputs/ });
    await expect(outputsTrigger).toContainText("1", { timeout: 10_000 });
    await outputsTrigger.click();
    // The "Open <title>" entry pins the artifact by its own exact title (which also appears in the
    // tool-call chip + the rendered markdown heading — the rail scope + exact name disambiguate).
    await expect(
      metaRail.getByRole("button", { name: `Open ${HUB_E2E_ARTIFACT_TITLE}` }),
    ).toBeVisible();

    // ── 2. Mission session: propose → plan card → approve → board completes → synthesis ────────────
    // The chat session above is now active — the EmptyState is gone, so this hop goes through the
    // session-switcher combobox (`openNewSessionDialog`'s second branch).
    await openNewSessionDialog(page);
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New session" })).toBeVisible();
    await dialog.getByRole("radio", { name: /mission/i }).click();
    await expect(dialog.getByRole("button", { name: "Start session" })).toBeEnabled({
      timeout: 15_000,
    });
    await dialog.getByRole("button", { name: "Start session" }).click();
    await expect(dialog).toBeHidden();

    const missionComposer = page.getByTestId("mention-editor");
    await missionComposer.fill(HUB_E2E_MISSION_ASK);
    await page.getByRole("button", { name: "Send message" }).click();

    // The planner's structured plan renders as the editable, in-band plan card.
    const planCard = page.getByTestId("mission-plan-card");
    await expect(planCard).toBeVisible({ timeout: 20_000 });
    await expect(planCard.getByText("E2E Stub Agent")).toBeVisible();

    await planCard.getByRole("button", { name: /approve/i }).click();

    // Approving spawns the one planned agent (a child session), collects its structured report, and
    // synthesizes — the board reconstructs its whole state from the parent session's event log alone
    // (R-SES1) and settles "Complete" once `mission_synthesis` lands.
    const board = page.getByTestId("mission-board");
    await expect(board).toBeVisible({ timeout: 20_000 });
    await expect(board.getByText("Complete", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(HUB_E2E_SYNTHESIS_TEXT)).toBeVisible({ timeout: 10_000 });

    // hub-fixes WP3.2 (RC4, D-HF4): the synthesis ran as a REAL turn of the parent session with the GenUI
    // `present` tool granted, so the final answer renders a widget (a StatGroup → `@elabs-ai/components-ui` MetricCard)
    // inline with the cited prose — the answer is no longer markdown-only. Its distinctive KPI-tile label
    // is proof the genui part settled on the synthesis message and rendered through the GenUiPart path.
    await expect(page.getByText(HUB_E2E_SYNTHESIS_STAT_LABEL).first()).toBeVisible({ timeout: 10_000 });
  });

  // ── hub-fixes WP3.2 (RC4, D-HF4) — the synthesis runs as a REAL turn of the parent session with GenUI
  // ─────────────────────────────────────────────────────────────────────────────────────────────────
  //
  // The deterministic, API-driven proof of WP3.2 (the browser-UI variant above is folded into the flagship
  // mission walk, which the CI grid covers): a mission (autonomy `auto`, so propose → auto-approve → run →
  // synthesize needs no UI) runs the FINAL answer as a real turn of the parent session with the GenUI
  // `present` tool granted (`HUB_SYNTHESIS_MODE=turn`, the default). The stub drives that turn to call
  // `present` (a valid StatGroup) then answer with the synthesis text, so the parent session log carries a
  // `tool_call` event tagged `source:"genui"` (the rendered-eligible widget part) alongside the synthesis
  // `assistant_message` — the WP3.2 target, proven end-to-end through the built app with no browser flake.
  test("mission synthesis runs as a real parent-session turn and emits a GenUI `present` widget (turn → assistant_message with a genui part)", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    // The stub `openai_compatible` credential (the hub's model roster resolves to it).
    const cred = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: `E2E Stub Model (synthesis-genui ${Date.now()})`,
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(cred.ok(), `POST /api/providers failed: ${cred.status()}`).toBeTruthy();

    // A mission session, autonomy `auto` (propose auto-approves + runs the whole flow through synthesis).
    const sessionRes = await request.post("/api/hub/sessions", {
      data: { mode: "mission", model: HUB_E2E_STUB_MODEL_ID, autonomy: "auto" },
    });
    expect(sessionRes.ok(), `POST /api/hub/sessions failed: ${sessionRes.status()}`).toBeTruthy();
    const session = (await sessionRes.json()) as { id: string };

    // Propose the flagship ask (its marker → the stub's canned single-agent plan) → auto-approve → run.
    const proposeRes = await request.post(`/api/hub/sessions/${session.id}/mission`, {
      data: { text: HUB_E2E_MISSION_ASK },
    });
    expect(proposeRes.ok(), `propose failed: ${proposeRes.status()}`).toBeTruthy();

    // Poll the PARENT session until the mission reaches its terminal (the run is fire-and-forget).
    type HubEventLite = {
      type: string;
      messageId?: string;
      part?: { type?: string; toolName?: string; source?: string };
      parts?: Array<{ type?: string; toolName?: string; source?: string; text?: string }>;
    };
    type SessionDetail = { events: HubEventLite[]; mission?: { status: string } };
    let detail: SessionDetail | undefined;
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/hub/sessions/${session.id}`);
          if (!res.ok()) return "pending";
          detail = (await res.json()) as SessionDetail;
          return detail.mission?.status ?? "pending";
        },
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBe("completed");

    const events = detail!.events;

    // The synthesis turn called the GenUI `present` tool — a `tool_call` event tagged `source:"genui"`
    // lives in the PARENT session log (the widget that renders through the GenUiPart path).
    const genuiCall = events.find(
      (e) => e.type === "tool_call" && e.part?.source === "genui" && e.part?.toolName === "present",
    );
    expect(genuiCall, "the synthesis turn emitted a GenUI `present` tool call into the parent log").toBeTruthy();

    // The synthesis `assistant_message` carries BOTH the genui widget part AND the cited synthesis prose —
    // the answer is no longer markdown-only.
    const synth = events.find((e) => e.type === "mission_synthesis");
    expect(synth?.messageId, "a mission_synthesis marker links the synthesis message").toBeTruthy();
    const synthMessage = events.find(
      (e) => e.type === "assistant_message" && e.messageId === synth!.messageId,
    );
    expect(synthMessage, "the synthesis assistant_message is in the parent log").toBeTruthy();
    const hasGenuiPart = (synthMessage!.parts ?? []).some(
      (p) => p.type === "tool_call" && p.source === "genui",
    );
    expect(hasGenuiPart, "the synthesis message's parts include a rendered-eligible genui part").toBeTruthy();
    const hasSynthesisText = (synthMessage!.parts ?? []).some(
      (p) => p.type === "text" && (p.text ?? "").includes(HUB_E2E_SYNTHESIS_TEXT),
    );
    expect(hasSynthesisText, "the synthesis message carries the synthesis prose alongside the widget").toBeTruthy();
  });

  // ── hub-fixes WP2.1 (RC2) — the turn-engine agent runner: a granted mission agent CALLS a real MCP tool
  // ─────────────────────────────────────────────────────────────────────────────────────────────────
  //
  // Drives the REAL turn-engine agent runner (HUB_AGENT_RUNNER=session, the default) against the stub
  // model + a REAL stdio MCP server (the read-only `read_echo` fixture). A saved crew grants that server to
  // one agent (the deterministic crew path — no planner model call), so on `auto` the mission auto-approves
  // and runs the agent as a REAL child hub session: the stub drives the child to CALL the granted read-only
  // MCP tool, the turn engine executes it (auto-approved — read-only under mission `auto`) and persists
  // `tool_call` + `tool_result` into the CHILD log, a bounded extraction yields a schema-valid report, and
  // synthesis runs. This is the RC2 fix proof — no provider key, no live LLM (the deterministic stub).
  // API-driven (deterministic) rather than driving the multi-step crew/mission UI, mirroring the seed-first
  // approach of the other engine-flow e2e above.
  test("mission agent runs a real child turn and calls a granted read-only MCP tool (tool_call + tool_result → report → synthesis)", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    // The stub `openai_compatible` credential (the hub's model roster resolves to it).
    const cred = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: `E2E Stub Model (mission-mcp ${Date.now()})`,
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(cred.ok(), `POST /api/providers failed: ${cred.status()}`).toBeTruthy();

    // Register + scan the READ-ONLY MCP fixture (its `read_echo` tool carries `readOnlyHint: true`).
    const serverRes = await request.post("/api/servers", {
      data: {
        name: `Read-only Echo ${Date.now()}`,
        transport: "stdio",
        command: "node",
        args: [readonlyEchoServer],
      },
    });
    expect(serverRes.ok(), `POST /api/servers failed: ${serverRes.status()}`).toBeTruthy();
    const server = (await serverRes.json()) as { id: string };
    const scanRes = await request.post(`/api/servers/${server.id}/scan`, { data: {} });
    expect(scanRes.ok(), `scan failed: ${scanRes.status()}`).toBeTruthy();

    // A library role that GRANTS the scanned server, on the stub model.
    const roleRes = await request.post("/api/hub/agents", {
      data: {
        name: "MCP Investigator",
        systemPrompt: "You investigate using the granted read-only tool, then report your findings.",
        defaultModel: HUB_E2E_STUB_MODEL_ID,
        target: "Call the read-only tool and report what it returned.",
        expectedOutcome: "A short structured report with one finding.",
        toolGrants: { servers: { [server.id]: "all" }, builtins: [] },
      },
    });
    expect(roleRes.ok(), `POST /api/hub/agents failed: ${roleRes.status()}`).toBeTruthy();
    const role = (await roleRes.json()) as { id: string };

    // A crew of that one role (the deterministic crew path — no planner model call).
    const crewRes = await request.post("/api/hub/crews", {
      data: { name: `MCP Crew ${Date.now()}`, topology: "parallel", members: [{ agentId: role.id }] },
    });
    expect(crewRes.ok(), `POST /api/hub/crews failed: ${crewRes.status()}`).toBeTruthy();
    const crew = (await crewRes.json()) as { id: string };

    // A mission session bound to the crew, autonomy `auto` (auto-approve + run on propose).
    const sessionRes = await request.post("/api/hub/sessions", {
      data: { mode: "mission", model: HUB_E2E_STUB_MODEL_ID, crewId: crew.id, autonomy: "auto" },
    });
    expect(sessionRes.ok(), `POST /api/hub/sessions failed: ${sessionRes.status()}`).toBeTruthy();
    const session = (await sessionRes.json()) as { id: string };

    // Propose (crew path → deterministic plan carrying the grant) → auto-approve → run. The ask carries
    // the mission-agent marker so the stub drives THIS agent's turn to call the read-only tool (the marker
    // flows into the crew-composed brief → the agent's turn messages).
    const proposeRes = await request.post(`/api/hub/sessions/${session.id}/mission`, {
      data: {
        text: `Investigate the target using your read-only tool and report what it returned. ${HUB_E2E_MCP_AGENT_MARKER}`,
      },
    });
    expect(proposeRes.ok(), `propose failed: ${proposeRes.status()}`).toBeTruthy();

    // Poll the PARENT session until the mission reaches a terminal (the run is fire-and-forget).
    type HubEventLite = {
      type: string;
      state?: string;
      part?: { toolName?: string; source?: string; serverId?: string };
    };
    type SessionDetail = {
      events: HubEventLite[];
      mission?: { status: string; agentSessionIds: string[] };
    };
    let detail: SessionDetail | undefined;
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/hub/sessions/${session.id}`);
          if (!res.ok()) return "pending";
          detail = (await res.json()) as SessionDetail;
          return detail.mission?.status ?? "pending";
        },
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBe("completed");

    // The child agent session log carries a REAL tool_call + tool_result for the granted read-only tool.
    const childId = detail!.mission!.agentSessionIds[0]!;
    expect(childId, "the mission spawned an agent child session").toBeTruthy();
    const childRes = await request.get(`/api/hub/sessions/${childId}`);
    expect(childRes.ok()).toBeTruthy();
    const childDetail = (await childRes.json()) as SessionDetail;

    const toolCall = childDetail.events.find(
      (e) => e.type === "tool_call" && e.part?.toolName === HUB_E2E_READONLY_TOOL_NAME,
    );
    expect(toolCall, "the child turn called the granted read-only MCP tool").toBeTruthy();
    expect(toolCall!.part!.source).toBe("mcp");
    expect(toolCall!.part!.serverId).toBe(server.id);
    expect(
      childDetail.events.some((e) => e.type === "tool_result" && e.state === "output-available"),
      "the granted read-only tool produced a real result in the child log",
    ).toBeTruthy();

    // The report reached the board (parent log) and synthesis ran.
    expect(
      detail!.events.some((e) => e.type === "agent_report"),
      "the mission board received the agent report",
    ).toBeTruthy();
    expect(
      detail!.events.some((e) => e.type === "mission_synthesis"),
      "synthesis ran after the agent report",
    ).toBeTruthy();

    // Cleanup — delete this test's mission + agent sessions so it does not leave a mission session as
    // the most-recently-active one (a later fresh-session test's `/assistant` auto-selects the most
    // recent; a lingering mission session would push it into the session-switcher branch). Best-effort.
    for (const id of [...detail!.mission!.agentSessionIds, session.id]) {
      await request.delete(`/api/hub/sessions/${id}`);
    }
  });

  // ── hub-fixes WP6.1 (RC7) — `auto` session mode routes chat-vs-mission per message ─────────────────
  //
  // Drives the REAL hub engine against the stub for an `auto` session across all THREE routes, API-driven
  // (deterministic — same seed-first pattern as the WP2.1/WP3.2 engine e2e above, no browser flake):
  //   1. TRIVIAL ask ⇒ a plain chat answer, NO mission events (the bridge proposes nothing).
  //   2. MISSION-SHAPED ask ⇒ the routing turn calls `mission.propose_plan` → the post-turn bridge runs
  //      the real planner → `plan_proposed`; the `always_ask` session leaves it PROPOSED (no silent
  //      launch — the plan-approval autonomy gate still applies: no `mission_started`/`agent_report`).
  //   3. AMBIGUOUS ask ⇒ the routing turn calls `prompt_user` (a `tool_call` tagged `source:"genui"` — the
  //      clarify card renders via the existing GenUiPart path), NO mission; then sending the "Run a
  //      mission" choice proposes — proving the clarify choice leads to the right path.
  test("auto mode routes per message: trivial⇒answer, mission-shaped⇒plan_proposed, ambiguous⇒prompt_user card", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const cred = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: `E2E Stub Model (auto-mode ${Date.now()})`,
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(cred.ok(), `POST /api/providers failed: ${cred.status()}`).toBeTruthy();

    type HubEventLite = {
      type: string;
      part?: { toolName?: string; source?: string };
      parts?: Array<{ type?: string; text?: string }>;
    };
    type SessionDetail = { events: HubEventLite[]; mission?: { status: string } };
    const getEvents = async (id: string): Promise<HubEventLite[]> => {
      const res = await request.get(`/api/hub/sessions/${id}`);
      if (!res.ok()) return [];
      return ((await res.json()) as SessionDetail).events;
    };
    const missionEventTypes = ["plan_proposed", "mission_started", "agent_report", "mission_synthesis"];
    const createAutoSession = async (): Promise<string> => {
      // `always_ask` so a proposed mission WAITS for approval (never auto-runs) — the autonomy gate.
      const res = await request.post("/api/hub/sessions", {
        data: { mode: "auto", model: HUB_E2E_STUB_MODEL_ID, autonomy: "always_ask" },
      });
      expect(res.ok(), `POST /api/hub/sessions failed: ${res.status()}`).toBeTruthy();
      return ((await res.json()) as { id: string }).id;
    };
    const send = async (id: string, text: string): Promise<void> => {
      const res = await request.post(`/api/hub/sessions/${id}/messages`, { data: { text } });
      expect(res.ok(), `POST messages failed: ${res.status()}`).toBeTruthy();
    };

    // ── 1. TRIVIAL ⇒ plain answer, no mission ──────────────────────────────────────────────────────
    const trivialId = await createAutoSession();
    await send(trivialId, HUB_E2E_AUTO_TRIVIAL_ASK);
    await expect
      .poll(
        async () => {
          const events = await getEvents(trivialId);
          return events.some(
            (e) =>
              e.type === "assistant_message" &&
              (e.parts ?? []).some((p) => p.type === "text" && (p.text ?? "").includes(HUB_E2E_CHAT_REPLY)),
          );
        },
        { timeout: 30_000, intervals: [300, 700, 1500] },
      )
      .toBe(true);
    const trivialEvents = await getEvents(trivialId);
    expect(
      trivialEvents.some((e) => missionEventTypes.includes(e.type)),
      "a trivial auto ask produced NO mission events",
    ).toBe(false);

    // ── 2. MISSION-SHAPED ⇒ plan_proposed, but NOT launched (always_ask autonomy gate) ─────────────
    const missionId = await createAutoSession();
    await send(missionId, HUB_E2E_AUTO_MISSION_ASK);
    await expect
      .poll(
        async () => (await getEvents(missionId)).some((e) => e.type === "plan_proposed"),
        { timeout: 60_000, intervals: [400, 800, 1500] },
      )
      .toBe(true);
    const missionEvents = await getEvents(missionId);
    // The routing turn actually called the mission-propose builtin (the model's signal, now bridged).
    expect(
      missionEvents.some((e) => e.type === "tool_call" && e.part?.toolName === "mission.propose_plan"),
      "the routing turn called mission.propose_plan",
    ).toBe(true);
    // The autonomy gate held: proposed, never launched (no silent mission start).
    expect(
      missionEvents.some((e) => e.type === "mission_started" || e.type === "agent_report"),
      "an always_ask auto mission is PROPOSED, not launched",
    ).toBe(false);
    const missionDetail = (await (await request.get(`/api/hub/sessions/${missionId}`)).json()) as SessionDetail;
    expect(missionDetail.mission?.status).toBe("proposed");

    // ── 3. AMBIGUOUS ⇒ prompt_user clarify card; then the "Run a mission" choice proposes ──────────
    const clarifyId = await createAutoSession();
    await send(clarifyId, HUB_E2E_AUTO_AMBIGUOUS_ASK);
    await expect
      .poll(
        async () =>
          (await getEvents(clarifyId)).some(
            (e) => e.type === "tool_call" && e.part?.toolName === "prompt_user" && e.part?.source === "genui",
          ),
        { timeout: 30_000, intervals: [300, 700, 1500] },
      )
      .toBe(true);
    const clarifyEvents = await getEvents(clarifyId);
    expect(
      clarifyEvents.some((e) => e.type === "plan_proposed"),
      "an ambiguous ask ASKS FIRST — it does not propose a mission until the user picks",
    ).toBe(false);

    // The clarify choice "Run a mission" leads to a real proposal (proving each choice routes correctly).
    await send(clarifyId, HUB_E2E_AUTO_MISSION_CHOICE);
    await expect
      .poll(
        async () => (await getEvents(clarifyId)).some((e) => e.type === "plan_proposed"),
        { timeout: 60_000, intervals: [400, 800, 1500] },
      )
      .toBe(true);

    // Cleanup so a lingering auto/mission session doesn't perturb a later fresh-session UI test.
    for (const id of [trivialId, missionId, clarifyId]) {
      await request.delete(`/api/hub/sessions/${id}`);
    }
  });

  // ── WP4.1 — choreography (D-HUX13) ──────────────────────────────────────────────────────────────
  test("choreography: a fresh session shows the greeting + starter chips; the first send docks the composer", async ({
    page,
    request,
  }) => {
    const cred = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: `E2E Stub Model (choreography ${Date.now()})`,
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(cred.ok(), `POST /api/providers failed: ${cred.status()}`).toBeTruthy();

    await page.goto("/assistant");
    // The page's own H1 ("Assistant") is intentionally `sr-only` (AT-only — page identity comes from
    // the AppShell breadcrumb per D-HUX2) — verified against a real Chromium run: a standard
    // `clip-path: inset(50%)` 1x1px sr-only element like this one falls out of Chromium's REAL
    // computed accessibility tree entirely (unlike the debug ARIA-snapshot tool, which reads more
    // leniently and still shows it), so `getByRole("heading", …)` never matches it at all — not even
    // via `toBeAttached()`. A raw tag locator sidesteps role computation and reliably finds it.
    await expect(page.locator("h1", { hasText: "Assistant" })).toBeAttached();

    await openNewSessionDialog(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New session" })).toBeVisible();
    const startButton = dialog.getByRole("button", { name: "Start session" });
    await expect(startButton).toBeEnabled({ timeout: 15_000 });
    await startButton.click();
    await expect(dialog).toBeHidden();

    // D-HUX13 — a fresh session opens CENTERED: the invitation heading + starter chips, the composer
    // told "centered" (`EmptySessionIntro`'s `data-dock-state`, WP1.3).
    const intro = page.getByTestId("empty-session-intro");
    await expect(intro).toHaveAttribute("data-dock-state", "centered");
    await expect(page.getByRole("heading", { name: "What should we dig into?" })).toBeVisible();
    // Mirrors `HUB_STARTER_SUGGESTIONS[0]` in `ConversationPane.tsx` (a `Suggestion` chip, role=button).
    const starter = page.getByRole("button", { name: "Summarize my last MCP scan" });
    await expect(starter).toBeVisible();

    // A starter chip sends immediately (`EmptySessionIntro`'s `onSelectStarter` → `handleSend`) — the
    // first send of this session, which glides the composer to the docked position for good.
    await starter.click();
    await expect(intro).toHaveAttribute("data-dock-state", "docked", { timeout: 10_000 });
    await expect(page.getByText(HUB_E2E_CHAT_REPLY)).toBeVisible({ timeout: 20_000 });
  });

  // ── WP4.1 — reduced motion (WP1.R-A regression guard + D-HUX13's "starts docked instantly") ──────
  test("reduced motion: greeting/starters stay visible on a fresh session and it still docks on send; a reopened session with history starts docked instantly", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: "reduce" });

    const cred = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: `E2E Stub Model (reduced-motion ${Date.now()})`,
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(cred.ok(), `POST /api/providers failed: ${cred.status()}`).toBeTruthy();

    await page.goto("/assistant");
    // The page's own H1 ("Assistant") is intentionally `sr-only` (AT-only — page identity comes from
    // the AppShell breadcrumb per D-HUX2) — verified against a real Chromium run: a standard
    // `clip-path: inset(50%)` 1x1px sr-only element like this one falls out of Chromium's REAL
    // computed accessibility tree entirely (unlike the debug ARIA-snapshot tool, which reads more
    // leniently and still shows it), so `getByRole("heading", …)` never matches it at all — not even
    // via `toBeAttached()`. A raw tag locator sidesteps role computation and reliably finds it.
    await expect(page.locator("h1", { hasText: "Assistant" })).toBeAttached();

    await openNewSessionDialog(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New session" })).toBeVisible();
    const startButton = dialog.getByRole("button", { name: "Start session" });
    await expect(startButton).toBeEnabled({ timeout: 15_000 });
    // Capture the created session's id from the real response so the "reopen" step below can deep-
    // link straight back to it (no reliance on "most recently active" — deterministic either way).
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" && res.url().includes("/api/hub/sessions") && res.ok(),
      ),
      startButton.click(),
    ]);
    const created = (await createResponse.json()) as { id: string };
    await expect(dialog).toBeHidden();

    // WP1.R-A regression guard: reduced motion suppresses the GLIDE, never the CONTENT — a fresh
    // session still opens with the greeting + interactive starter chips, never `aria-hidden`.
    const intro = page.getByTestId("empty-session-intro");
    await expect(intro).toHaveAttribute("data-dock-state", "centered");
    const greeting = page.getByTestId("empty-session-intro-greeting");
    await expect(greeting).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByRole("heading", { name: "What should we dig into?" })).toBeVisible();
    const starter = page.getByRole("button", { name: "Summarize my last MCP scan" });
    await expect(starter).toBeVisible();
    await expect(starter).toBeEnabled();

    await starter.click();
    // Under reduced motion the transition class is dropped, but the dock STATE still lands docked.
    await expect(intro).toHaveAttribute("data-dock-state", "docked", { timeout: 10_000 });
    await expect(page.getByText(HUB_E2E_CHAT_REPLY)).toBeVisible({ timeout: 20_000 });

    // D-HUX13 — "sessions with history start docked; motion-reduce renders the docked state
    // instantly." Reopen the SAME (now-history) session fresh, still under reduced motion: it must
    // mount directly docked, with no centered frame ever appearing.
    await page.goto(`/assistant?session=${created.id}`);
    const reopenedIntro = page.getByTestId("empty-session-intro");
    await expect(reopenedIntro).toHaveAttribute("data-dock-state", "docked");
    await expect(page.getByTestId("empty-session-intro-greeting")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  // ── WP4.1 — meta rail (D-HUX3): Progress + Outputs update from a real send ───────────────────────
  test("send → the meta rail's Progress and Outputs sections reflect the turn", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const cred = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: `E2E Stub Model (meta-rail ${Date.now()})`,
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(cred.ok(), `POST /api/providers failed: ${cred.status()}`).toBeTruthy();

    await page.goto("/assistant");
    // The page's own H1 ("Assistant") is intentionally `sr-only` (AT-only — page identity comes from
    // the AppShell breadcrumb per D-HUX2) — verified against a real Chromium run: a standard
    // `clip-path: inset(50%)` 1x1px sr-only element like this one falls out of Chromium's REAL
    // computed accessibility tree entirely (unlike the debug ARIA-snapshot tool, which reads more
    // leniently and still shows it), so `getByRole("heading", …)` never matches it at all — not even
    // via `toBeAttached()`. A raw tag locator sidesteps role computation and reliably finds it.
    await expect(page.locator("h1", { hasText: "Assistant" })).toBeAttached();

    // ── Outputs: a chat turn that creates an artifact ────────────────────────────────────────────
    await openNewSessionDialog(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New session" })).toBeVisible();
    const startButton = dialog.getByRole("button", { name: "Start session" });
    await expect(startButton).toBeEnabled({ timeout: 15_000 });
    await startButton.click();
    await expect(dialog).toBeHidden();

    const composer = page.getByTestId("mention-editor");
    await composer.fill(HUB_E2E_ARTIFACT_MESSAGE);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(HUB_E2E_ARTIFACT_REPLY)).toBeVisible({ timeout: 20_000 });

    // The rail's Outputs section keeps a live count in its header even while collapsed
    // (`RailSection.tsx`'s §8.3 rule: "a collapsed section keeps a count in its header"). At this
    // wide viewport the rail renders INLINE (`aria-label="Session meta rail"`, D-HUX3) rather than
    // the narrow-viewport Sheet fallback.
    const metaRail = page.getByLabel("Session meta rail");
    const outputsTrigger = metaRail.getByRole("button", { name: /Outputs/ });
    await expect(outputsTrigger).toContainText("1", { timeout: 10_000 });
    // The Outputs section is a controlled Radix Collapsible whose default open state varies with
    // content — a blind toggle-click flakes because it COLLAPSES an already-open section and hides the
    // artifact button. Read the trigger's aria-expanded (deterministic, unlike a visibility snapshot)
    // and only click when it's actually collapsed; then assert it's open before checking the button.
    if ((await outputsTrigger.getAttribute("aria-expanded")) !== "true") {
      await outputsTrigger.click();
    }
    await expect(outputsTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(
      metaRail.getByRole("button", { name: `Open ${HUB_E2E_ARTIFACT_TITLE}` }),
    ).toBeVisible({ timeout: 20_000 });

    // ── Progress: a mission turn's live agent roster surfaces in the SAME always-visible rail ─────
    await openNewSessionDialog(page);
    await expect(dialog.getByRole("heading", { name: "New session" })).toBeVisible();
    await dialog.getByRole("radio", { name: /mission/i }).click();
    await expect(startButton).toBeEnabled({ timeout: 15_000 });
    await startButton.click();
    await expect(dialog).toBeHidden();

    const missionComposer = page.getByTestId("mention-editor");
    await missionComposer.fill(HUB_E2E_MISSION_ASK);
    await page.getByRole("button", { name: "Send message" }).click();

    const planCard = page.getByTestId("mission-plan-card");
    await expect(planCard).toBeVisible({ timeout: 20_000 });
    await planCard.getByRole("button", { name: /approve/i }).click();

    // `ProgressSection`'s `progressCount` sums live tasks + the mission board's agent roster —
    // reconstructed purely from the session's own SSE event log (R-SES1), same as the in-stream
    // board. Scoped to the SAME `metaRail` above, since the same "N of N agents reported" line ALSO
    // renders in-stream on the `MissionBoard` card (`getByText` alone would be ambiguous).
    const progressTrigger = metaRail.getByRole("button", { name: /Progress/ });
    await expect(progressTrigger).toContainText("1", { timeout: 20_000 });
    await expect(metaRail.getByText(/agents reported/)).toBeVisible();

    const board = page.getByTestId("mission-board");
    await expect(board).toBeVisible({ timeout: 20_000 });
    await expect(board.getByText("Complete", { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  // ── WP4.1 — sessions table → open session (D-HUX4) ───────────────────────────────────────────────
  test("sessions table → open session in the workspace", async ({ page, request }) => {
    const cred = await request.post("/api/providers", {
      data: {
        kind: "openai_compatible",
        label: `E2E Stub Model (sessions-table ${Date.now()})`,
        baseUrl: stub.url,
        apiKey: "stub-key",
      },
    });
    expect(cred.ok(), `POST /api/providers failed: ${cred.status()}`).toBeTruthy();

    // Seed a session directly (deterministic — favours reliability over driving the New-session
    // dialog again) and give it a unique title so the table row is unambiguous among every other
    // session earlier tests in this file created.
    const uniqueTitle = `WP4.1 sessions-table smoke ${Date.now()}`;
    const createdSession = await request.post("/api/hub/sessions", {
      data: { mode: "chat", model: HUB_E2E_STUB_MODEL_ID },
    });
    expect(
      createdSession.ok(),
      `POST /api/hub/sessions failed: ${createdSession.status()}`,
    ).toBeTruthy();
    const session = (await createdSession.json()) as { id: string };
    const renamed = await request.patch(`/api/hub/sessions/${session.id}`, {
      data: { title: uniqueTitle },
    });
    expect(renamed.ok(), `PATCH /api/hub/sessions/:id failed: ${renamed.status()}`).toBeTruthy();

    await page.goto("/assistant/sessions");
    const searchInput = page.getByLabel("Search sessions");
    await searchInput.fill(uniqueTitle);

    // `navCol`'s row title button (`columns.tsx`'s `buildSessionColumns`) carries this exact
    // aria-label; clicking it navigates to `/assistant?session=<id>` (`SessionsView.openSession`).
    const row = page.getByRole("button", { name: `Open ${uniqueTitle} in the workspace` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    await expect(page).toHaveURL(/\/assistant\?session=/);
    const openedUrl = new URL(page.url());
    expect(openedUrl.searchParams.get("session")).toBe(session.id);
    // The breadcrumb session switcher's trigger shows the opened session's own title — proof the
    // workspace actually resolved the deep link, not just navigated to a bare `/assistant`. The
    // switcher is now `SessionBreadcrumbSwitcher` (aria-label "Switch session"), not the old
    // `[role="combobox"]` Combobox (which T9 would now confuse with the composer — see
    // `openNewSessionDialog`'s doc). Its accessible name is the aria-label; its visible TEXT carries
    // the active session's title, which `toContainText` reads.
    await expect(page.getByRole("button", { name: "Switch session" })).toContainText(uniqueTitle, {
      timeout: 10_000,
    });
  });

  // ── WP4.1 — workforce: quick-create → profile → grant a tool → Org chart / Usage tabs (D-HUX5/7) ──
  test("workforce: quick-create an agent → grant one tool → the Org chart and Usage tabs render it", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    // A scanned MCP server gives the Access section a real, scan-measured tool to grant (D-HUX7).
    const serverName = `Workforce Access Echo ${Date.now()}`;
    const createdServer = await request.post("/api/servers", {
      data: { name: serverName, transport: "stdio", command: "node", args: [echoServer] },
    });
    expect(createdServer.ok(), `POST /api/servers failed: ${createdServer.status()}`).toBeTruthy();
    const server = (await createdServer.json()) as { id: string };
    const scanned = await request.post(`/api/servers/${server.id}/scan`, { data: {} });
    expect(scanned.ok(), `scan failed: ${scanned.status()}`).toBeTruthy();

    const agentName = `WP4.1 Quick Agent ${Date.now()}`;

    await page.goto("/assistant/agents");
    await expect(page.getByRole("heading", { name: "Agents & Crews" })).toBeVisible();

    // `WorkforceView`'s PageHeader "+ New" split button → "New agent" menu item (D-HUX5). `.first()`
    // — the always-visible Directory-tab toolbar ALSO renders its own exact-"New" split button
    // (`DirectoryTab.tsx`) further down the page; the PageHeader's own comes first in DOM order.
    await page.getByRole("button", { name: "New", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "New agent" }).click();

    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "New agent" })).toBeVisible();
    // `exact: true` — Playwright's default label matching is a case-insensitive substring, and
    // "Name" would otherwise also match the "Display name (optional)" field's label.
    await createDialog.getByLabel("Name", { exact: true }).fill(agentName);
    await createDialog.getByLabel("Default model", { exact: true }).fill("e2e-quickcreate-model");
    await createDialog.getByRole("button", { name: "Create agent" }).click();

    // "Create, then open profile" (D-HUX5) — the profile modal opens on the new agent IMMEDIATELY
    // (no gap where zero dialogs are open), so a generic `getByRole("dialog")` locator never actually
    // goes hidden — asserting the profile heading appears is the real, unambiguous proof the create
    // dialog closed and handed off correctly.
    const profileDialog = page.getByRole("dialog");
    await expect(profileDialog.getByRole("heading", { name: agentName })).toBeVisible({
      timeout: 10_000,
    });

    // The Access section (D-HUX7's centerpiece): a left-rail nav item inside the `WideDialog`.
    await profileDialog.getByRole("button", { name: "Access" }).click();
    await expect(profileDialog.getByText("0 tools across 0 servers")).toBeVisible({
      timeout: 10_000,
    });

    const serverTrigger = profileDialog.getByRole("button", { name: new RegExp(serverName) });
    await expect(serverTrigger).toBeVisible({ timeout: 10_000 });
    await serverTrigger.click();
    // Let the accordion's open animation settle before the tool checkbox is asked to be actionable.
    await page.waitForTimeout(300);

    // `exact: true` — the server's OWN tri-state "grant all" checkbox is
    // `aria-label="Grant all tools from ${serverName}"`, and `serverName` contains "Echo", so a
    // non-exact "echo" match is ambiguous between the two checkboxes.
    const toolCheckbox = profileDialog.getByRole("checkbox", { name: "echo", exact: true });
    await expect(toolCheckbox).toBeVisible();
    await toolCheckbox.check();

    // D-HUX7 — every granted tool rolls into a running footprint total (count AND token cost).
    await expect(profileDialog.getByText("1 tool across 1 server")).toBeVisible();
    await expect(serverTrigger.getByText(/\d[\d,]* tok/)).toBeVisible();

    await profileDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(profileDialog).toBeHidden({ timeout: 10_000 });

    // The Org chart tab renders the new (unassigned) agent as a node (a `role="button"` `FlowNode`
    // label). `exact` role match, not `getByText` — the "Created "<name>"" toast can still be
    // settling and also carries the agent's name as text.
    await page.getByRole("tab", { name: "Org chart" }).click();
    await expect(page.getByRole("button", { name: agentName, exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // The Usage tab renders the workforce-wide KPI row (D-HUX10, `UsageKpis.tsx`'s `MetricGrid`).
    // "Tokens (in / out)" is one of its 4 `MetricCard` labels and — unlike "Spend"/"Sessions" — is
    // not also a chart title or a sidebar nav link elsewhere on the page, so it's unambiguous.
    await page.getByRole("tab", { name: "Usage" }).click();
    await expect(page.getByText("Tokens (in / out)")).toBeVisible({ timeout: 10_000 });
  });

  // ── WP4.1 — usage drill → sessions (D-HUX10) ──────────────────────────────────────────────────────
  test("usage drill → sessions (a rollup row links to a filtered Sessions view)", async ({
    page,
  }) => {
    // Force a mode-grouped rollup — the dimension `usage-links.ts`'s `drillDestinationFor` sends to
    // Sessions (`?mode=`), rather than "agent"/"crew" (→ a profile) or "project" (→ an in-tab narrow).
    // The many chat/mission sessions the earlier WP4.1/WP4.4 tests created (all-time, no date filter)
    // give this at least one real, non-unattributed "mode" row to click.
    await page.goto("/assistant/agents?tab=usage&uGroupBy=mode");
    // "Tokens (in / out)" — see the workforce test above for why this KPI label (not "Spend", which
    // also titles two charts on this same tab) is the unambiguous "the tab has loaded" signal.
    await expect(page.getByText("Tokens (in / out)")).toBeVisible({ timeout: 15_000 });

    const drillButton = page.getByRole("button", { name: /^View sessions for / }).first();
    await expect(drillButton).toBeVisible({ timeout: 15_000 });
    await drillButton.click();

    await expect(page).toHaveURL(/\/assistant\/sessions\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("mode") ?? url.searchParams.get("model")).toBeTruthy();
    await expect(page.getByLabel("Search sessions")).toBeVisible();
  });
});
