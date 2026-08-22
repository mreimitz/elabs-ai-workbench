import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Alert, AlertDescription, Button, Text, toast } from "@elabs-ai/components-ui";
import type { DiagnosticsBundle } from "@mcp-token-footprint/shared";
import { WideDialog } from "../../components/dialogs";
import { CodeSnippet } from "../testing/CodeSnippet";
import { getDiagnosticsBundle, getDiagnosticsMarkdown } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Diagnostics bundle — planning/Roadmap/RM-18-platform/ WP 1.3.
 *
 * One action in Settings › Storage, beside the maintenance controls, that produces one document
 * an operator can paste into a bug report.
 *
 * The dialog SHOWS the bundle before anything leaves the machine, and that is deliberate rather
 * than decorative: the whole work package exists so nobody has to take "it's redacted" on trust.
 * A blind download would put the reader back in the position of having to audit the file
 * themselves, which is precisely the decision the endpoint is meant to have already made for
 * them. Both renderings are shown — the Markdown is what you paste, the JSON is what a maintainer
 * would rather have — so the reader can satisfy themselves in whichever one they can read.
 *
 * Nothing here uploads anything (WP §7, out of scope). The operator copies it themselves.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

type Loaded = { markdown: string; bundle: DiagnosticsBundle };

export function DiagnosticsRow(props: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState("markdown");

  async function generate() {
    setBusy(true);
    setError(null);
    setLoaded(null);
    setActiveSectionId("markdown");
    setOpen(true);
    try {
      // Both renderings in one go, so the reader can check either without a second wait.
      const [markdown, bundle] = await Promise.all([
        getDiagnosticsMarkdown(),
        getDiagnosticsBundle(),
      ]);
      setLoaded({ markdown, bundle });
    } catch (caught) {
      setError(getErrorMessage(caught, "Couldn’t build the diagnostics bundle. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const markdownText = loaded?.markdown ?? "";
  const jsonText = loaded === null ? "" : JSON.stringify(loaded.bundle, null, 2);
  const activeText = activeSectionId === "json" ? jsonText : markdownText;

  async function copyActive() {
    if (activeText.length === 0) return;
    try {
      await navigator.clipboard.writeText(activeText);
      toast.success(
        activeSectionId === "json" ? "Diagnostics JSON copied" : "Diagnostics Markdown copied",
      );
    } catch (caught) {
      notifyError("Couldn’t copy to the clipboard. Select the text and copy it manually.", {
        description: getErrorMessage(caught),
      });
    }
  }

  const body = (language: "markdown" | "json", value: string) => {
    if (error !== null) {
      return (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }
    if (loaded === null) {
      return (
        <Text variant="meta" tone="muted">
          Building the bundle…
        </Text>
      );
    }
    return (
      <CodeSnippet
        value={value}
        language={language}
        ariaLabel={
          language === "json" ? "Diagnostics bundle as JSON" : "Diagnostics bundle as Markdown"
        }
        maxHeightClassName="max-h-[52vh]"
      />
    );
  };

  return (
    <>
      <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <LifeBuoy className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-medium">Diagnostics bundle</span>
            <Text variant="meta" tone="muted">
              Versions, environment presence, database counts and redacted recent errors — for a bug
              report. No environment values and no credentials, ever; check the errors section,
              which quotes messages verbatim.
            </Text>
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void generate()}
          disabled={props.disabled}
        >
          Build bundle
        </Button>
      </li>

      <WideDialog
        open={open}
        onOpenChange={setOpen}
        title="Diagnostics bundle"
        description="Read it, then copy it into your bug report. Nothing is sent anywhere from here."
        nav="tabs"
        activeSectionId={activeSectionId}
        onActiveSectionChange={setActiveSectionId}
        sections={[
          { id: "markdown", label: "Markdown", content: body("markdown", markdownText) },
          { id: "json", label: "JSON", content: body("json", jsonText) },
        ]}
        headerActions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyActive()}
            disabled={loaded === null || busy}
          >
            Copy
          </Button>
        }
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <Text variant="meta" tone="muted">
              Environment variables appear by name and status only — no value is ever read, and no
              credential is anywhere in here. Recent errors are the one section quoted verbatim
              (credential-masked and length-capped), so a message can name a path you configured.
            </Text>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        }
      />
    </>
  );
}
