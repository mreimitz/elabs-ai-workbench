import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Skill, TriggerCollision } from "@mcp-token-footprint/shared";

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

const getRegistryTriggerCollisions = vi.fn();
vi.mock("./skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills-inspector-api")>();
  return { ...actual, getRegistryTriggerCollisions: () => getRegistryTriggerCollisions() };
});

import { SkillsOverview } from "./SkillsOverview";

// The registry OVERVIEW (RM-32 WP 2.2). Beyond the grid/table grammar the kit already pins, two
// things are specific to Skills and worth locking: grouping by SOURCE (the only dimension a `Skill`
// carries), and the registry-wide trigger-collision report living HERE — a cross-skill concern
// belongs to the whole registry, never inside one skill's inspector (D-UX2 / K7).

function skill(id: string, displayName: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id,
    name: displayName.toLowerCase().replace(/\s+/g, "-"),
    displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, "-"),
    sourceType: "upload",
    versionCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const githubSkill = (id: string, name: string) =>
  skill(id, name, {
    sourceType: "github",
    github: { repoUrl: "https://github.com/acme/skills", ref: "main", subpath: "", hasAuth: false },
  });

function mount(options?: {
  skills?: Skill[];
  onAddSkill?: () => void;
  onPullSkill?: (id: string) => void;
  onDeleteSkill?: (skill: Skill) => void;
  isBusy?: (key: string) => boolean;
}) {
  return render(
    <MemoryRouter initialEntries={["/skills"]}>
      <TooltipProvider>
        <SkillsOverview
          skills={options?.skills ?? []}
          isBusy={options?.isBusy ?? (() => false)}
          onAddSkill={options?.onAddSkill ?? (() => {})}
          onPullSkill={options?.onPullSkill ?? (() => {})}
          onDeleteSkill={options?.onDeleteSkill ?? (() => {})}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function cardFor(name: string): HTMLElement {
  const card = document.querySelector(`[data-entity-card="${name}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return card;
}

beforeEach(() => {
  window.localStorage.clear();
  getRegistryTriggerCollisions.mockResolvedValue([]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("SkillsOverview", () => {
  test("groups by source, GitHub before Upload", async () => {
    mount({ skills: [skill("a", "Alpha"), githubSkill("b", "Bravo")] });
    await screen.findByRole("link", { name: "Alpha" });
    expect(
      screen.getAllByRole("region").map((section) => section.getAttribute("aria-label")),
    ).toEqual(["GitHub", "Upload"]);
  });

  test("a card links to the skill's inspector route", async () => {
    mount({ skills: [skill("a", "Alpha")] });
    expect(await screen.findByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/skills/a");
  });

  test("search covers the name, the description and the repo", async () => {
    mount({
      skills: [
        skill("a", "Alpha", { description: "handles invoices" }),
        githubSkill("b", "Bravo"),
      ],
    });
    await screen.findByRole("link", { name: "Alpha" });
    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "invoices" } });
    expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Bravo" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "acme/skills" } });
    expect(screen.getByRole("link", { name: "Bravo" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Alpha" })).toBeNull();
  });

  test("Pull latest is offered for a GitHub skill only, and targets THAT skill", async () => {
    const onPullSkill = vi.fn();
    mount({ skills: [skill("a", "Alpha"), githubSkill("b", "Bravo")], onPullSkill });
    await screen.findByRole("link", { name: "Bravo" });
    expect(within(cardFor("Alpha")).queryByRole("button", { name: /Pull latest/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pull latest for Bravo" }));
    expect(onPullSkill).toHaveBeenCalledWith("b");
  });

  test("a busy pull disables the action rather than firing twice", async () => {
    const onPullSkill = vi.fn();
    mount({
      skills: [githubSkill("b", "Bravo")],
      onPullSkill,
      isBusy: (key) => key === "skill:pull:b",
    });
    await screen.findByRole("link", { name: "Bravo" });
    expect(screen.getByRole("button", { name: "Pull latest for Bravo" })).toBeDisabled();
  });

  test("an empty registry shows the zero state with Add skill, and no collision report", async () => {
    const onAddSkill = vi.fn();
    mount({ onAddSkill });
    const [add] = await screen.findAllByRole("button", { name: "Add skill" });
    fireEvent.click(add as HTMLElement);
    expect(onAddSkill).toHaveBeenCalled();
    expect(getRegistryTriggerCollisions).not.toHaveBeenCalled();
  });

  test("the registry-wide collision report lives on the overview and reports a clean registry", async () => {
    mount({ skills: [skill("a", "Alpha"), githubSkill("b", "Bravo")] });
    expect(await screen.findByText("2 skills · no collisions")).toBeTruthy();
  });

  test("the collision report names each collision and deep-links the skills involved", async () => {
    const collision: TriggerCollision = {
      kind: "command",
      value: "/deploy",
      skillIds: ["a", "b"],
    };
    getRegistryTriggerCollisions.mockResolvedValue([collision]);
    mount({ skills: [skill("a", "Alpha"), githubSkill("b", "Bravo")] });
    expect(await screen.findByText("1 trigger collision")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trigger collisions" }));
    await waitFor(() => expect(screen.getByText("/deploy")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
  });

  test("a failed collision check reads as an error, never as a clean registry", async () => {
    getRegistryTriggerCollisions.mockRejectedValue(new Error("nope"));
    mount({ skills: [skill("a", "Alpha")] });
    expect(await screen.findByText("Couldn’t check triggers")).toBeTruthy();
    expect(screen.queryByText(/no collisions/)).toBeNull();
  });
});
