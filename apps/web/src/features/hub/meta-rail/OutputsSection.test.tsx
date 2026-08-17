import type { HubArtifact, HubFile, HubWorkspaceSnapshot } from "@mcp-token-footprint/shared";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ReactElement } from "react";
import { OutputsSection } from "./OutputsSection";

// The file-download action renders a manual Tooltip (IconButton can't wrap a real `asChild` <a>) —
// that throws without an ancestor `TooltipProvider` (the app root mounts one; this file's render
// doesn't get it automatically).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function artifact(over: Partial<HubArtifact> & { id: string }): HubArtifact {
  return {
    kind: "markdown",
    title: over.id,
    latestVersion: 1,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function file(over: Partial<HubFile> & { id: string }): HubFile {
  return {
    sha256: "abc",
    mime: "text/plain",
    bytes: 1024,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function snapshot(over: Partial<HubWorkspaceSnapshot> & { id: string }): HubWorkspaceSnapshot {
  return { createdAt: "2026-07-01T00:00:00Z", fileCount: 2, totalBytes: 2048, ...over };
}

describe("OutputsSection (WP1.2, D-HUX3 — artifacts + workspace files merged into one list)", () => {
  test("renders one EmptyState when artifacts, files, and snapshots are all empty", () => {
    render(<OutputsSection artifacts={[]} files={[]} />);
    expect(screen.getByText("No outputs yet")).toBeInTheDocument();
  });

  test("merges artifacts and files into one list", () => {
    render(
      <OutputsSection
        artifacts={[artifact({ id: "report", title: "Report.md" })]}
        files={[{ file: file({ id: "f1", filename: "notes.txt" }) }]}
      />,
    );
    expect(screen.getByText("Report.md")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.queryByText("No outputs yet")).not.toBeInTheDocument();
  });

  test("opening an artifact fires onOpenArtifact with the artifact", () => {
    const onOpenArtifact = vi.fn();
    const art = artifact({ id: "report", title: "Report.md" });
    render(<OutputsSection artifacts={[art]} files={[]} onOpenArtifact={onOpenArtifact} />);
    fireEvent.click(screen.getByRole("button", { name: /open report\.md/i }));
    expect(onOpenArtifact).toHaveBeenCalledWith(art);
  });

  test("a file with getFileDownloadUrl renders a real download link", () => {
    render(
      <OutputsSection
        artifacts={[]}
        files={[{ file: file({ id: "f1", filename: "notes.txt" }) }]}
        getFileDownloadUrl={(f) => `/api/hub/files/${f.id}`}
      />,
    );
    const link = screen.getByRole("link", { name: /download notes\.txt/i });
    expect(link).toHaveAttribute("href", "/api/hub/files/f1");
    expect(link).toHaveAttribute("download");
  });

  test("a file with no getFileDownloadUrl renders no download action (no crash)", () => {
    render(<OutputsSection artifacts={[]} files={[{ file: file({ id: "f1", filename: "notes.txt" }) }]} />);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("snapshots render as their own group with a Restore action", () => {
    const onRestoreSnapshot = vi.fn();
    render(
      <OutputsSection
        artifacts={[]}
        files={[]}
        snapshots={[snapshot({ id: "snap-1", label: "Before refactor" })]}
        onRestoreSnapshot={onRestoreSnapshot}
      />,
    );
    expect(screen.getByText("Snapshots")).toBeInTheDocument();
    expect(screen.getByText("Before refactor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    expect(onRestoreSnapshot).toHaveBeenCalledWith("snap-1");
  });

  test("no mid-word clipping contract: a long file name truncates inside a min-w-0 row", () => {
    render(
      <OutputsSection
        artifacts={[]}
        files={[
          {
            file: file({
              id: "f1",
              filename: "a-very-long-uploaded-filename-that-must-not-clip-mid-word-in-the-rail.txt",
            }),
          },
        ]}
      />,
    );
    const name = screen.getByText(/a-very-long-uploaded-filename/);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
  });
});
