import { describe, expect, test } from "vitest";
import {
  CUSTOM_CHART_PANEL_PREFIX,
  DASHBOARD_PANEL_IDS,
  DASHBOARD_PANEL_PARAM,
  customChartPanelId,
  panelDomId,
  panelLinkPath,
  withPanelParam,
} from "./panel-anchor";

describe("panel ids", () => {
  test("every prebuilt id is unique — an id IS the address a shared link carries", () => {
    const ids = Object.values(DASHBOARD_PANEL_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ids are URL- and DOM-safe (no spaces, no characters a query string would escape)", () => {
    for (const id of Object.values(DASHBOARD_PANEL_IDS)) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(id)).toBe(id);
    }
  });

  test("a custom chart's id is its persisted row id, prefixed so it cannot collide with a prebuilt one", () => {
    expect(customChartPanelId("Ab3-x_9")).toBe("chart-Ab3-x_9");
    for (const id of Object.values(DASHBOARD_PANEL_IDS)) {
      expect(id.startsWith(CUSTOM_CHART_PANEL_PREFIX)).toBe(false);
    }
  });

  test("the DOM id is namespaced so it cannot clash with an unrelated element", () => {
    expect(panelDomId(DASHBOARD_PANEL_IDS.cache)).toBe("dashboard-panel-cache");
    expect(panelDomId(customChartPanelId("row-1"))).toBe("dashboard-panel-chart-row-1");
  });
});

describe("withPanelParam", () => {
  test("keeps every other key — the copied link reproduces the whole view, not just the panel", () => {
    const params = new URLSearchParams({
      tab: "testing",
      range: "30d",
      tGroupBy: "server",
      tBucket: "hour",
      tServer: "srv-1,srv-2",
    });
    const next = withPanelParam(params, DASHBOARD_PANEL_IDS.cost);
    expect(next.get(DASHBOARD_PANEL_PARAM)).toBe("cost");
    expect(next.get("tab")).toBe("testing");
    expect(next.get("range")).toBe("30d");
    expect(next.get("tGroupBy")).toBe("server");
    expect(next.get("tBucket")).toBe("hour");
    expect(next.get("tServer")).toBe("srv-1,srv-2");
  });

  test("does not mutate the input, and replaces an existing anchor rather than appending one", () => {
    const params = new URLSearchParams({ panel: "cost", tab: "testing" });
    const next = withPanelParam(params, DASHBOARD_PANEL_IDS.tokens);
    expect(params.get("panel")).toBe("cost");
    expect(next.getAll("panel")).toEqual(["tokens"]);
  });
});

describe("panelLinkPath", () => {
  test("composes pathname + the anchored query", () => {
    const path = panelLinkPath("/dashboard", new URLSearchParams({ tab: "testing" }), "cache");
    expect(path).toBe("/dashboard?tab=testing&panel=cache");
  });

  test("a paramless view still gets a usable link", () => {
    expect(panelLinkPath("/dashboard", new URLSearchParams(), "cache")).toBe("/dashboard?panel=cache");
  });
});
