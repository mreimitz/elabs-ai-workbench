import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Collection } from "@mcp-token-footprint/shared";
import { selectCorrectedOutput } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { PencilLine } from "lucide-react";
import { FormDialog } from "../../components/dialogs";
import { FieldRow } from "../../components/FieldRow";
import { listCollections, listRunFeedback, promoteRunToTest } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

/**
 * Console "Promote to test" (D-OB21) — the collection picker reached from the run console's overflow
 * menu on any TERMINAL run (`RunBar`'s "Promote to test…" item). Calls the same domain path WP4.1's
 * `promote_to_test` watch action uses, on demand for one run.
 *
 * RM-17 Phase 6 (AM-OB2): the backing `POST /api/runs/:id/promote-to-test` route now EXISTS (it was a
 * documented stub — this dialog 404'd in production and passed only against a mocked fetch), and the
 * dialog previews the **corrected answer** the draft will expect, so promoting is never a blind
 * action. The three states it can show are deliberately distinct:
 *   - the correction, verbatim         → "this text becomes the expected answer";
 *   - "no corrected answer captured"   → say so, and say what happens instead (the source test's
 *                                        expectation is carried over unchanged);
 *   - still loading / lookup failed    → neither of the above is claimed.
 */
export function PromoteToTestDialog({
  open,
  onOpenChange,
  runId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
}) {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [collectionId, setCollectionId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `null` = not resolved yet (or the lookup failed); a settled read is `{ text: string | undefined }`
  // so "no correction captured" is never rendered from an unfinished fetch.
  const [correction, setCorrection] = useState<{ text: string | undefined } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setLoading(true);
    setCorrection(null);
    let active = true;
    listCollections()
      .then((list) => {
        if (!active) return;
        setCollections(list);
        const preferred = list.find((c) => c.isDefault) ?? list[0];
        setCollectionId(preferred?.id ?? "");
      })
      .catch((err) => {
        if (active)
          setError(getErrorMessage(err, "Couldn’t load collections. Close and reopen this dialog to try again."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // Supplementary (never blocks the promote): a failed lookup leaves `correction` null, so the
    // preview stays silent rather than asserting there is no correction.
    listRunFeedback(runId)
      .then((rows) => {
        if (active) setCorrection({ text: selectCorrectedOutput(rows) });
      })
      .catch(() => {
        /* preview only — the server still applies whatever correction the run actually carries */
      });
    return () => {
      active = false;
    };
  }, [open, runId]);

  async function submit() {
    if (!collectionId) {
      setError("Pick a collection.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await promoteRunToTest(runId, collectionId);
      const collectionName = collections.find((c) => c.id === collectionId)?.name ?? "the collection";
      onOpenChange(false);
      toast.success("Draft test created", {
        description: result.usedCorrectedOutput
          ? `Promoted into ${collectionName}, expecting your corrected answer.`
          : `Promoted into ${collectionName}.`,
        action: {
          label: "Open collection",
          onClick: () => navigate(`/testing/collections/${collectionId}`),
        },
        // Interface Craft WP 3.1 (finding 5, D-IC7): an actionable toast must not expire (WCAG
        // 2.2.1) — the operator needs time to notice and use "Open collection".
        duration: Infinity,
      });
    } catch (err) {
      setError(getErrorMessage(err, "Couldn’t promote this run to a test. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Promote to test"
      description="Creates a draft test from this run's prompt and configuration — never runs automatically."
      primaryLabel="Create draft test"
      onSubmit={() => void submit()}
      busy={saving}
      submitDisabled={loading || collections.length === 0}
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner className="size-4" />
          <Text variant="meta" tone="muted">
            Loading collections…
          </Text>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <FieldRow id="promote-collection" label="Collection" error={error ?? undefined}>
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger id="promote-collection" aria-invalid={error ? true : undefined}>
                <SelectValue placeholder="Select a collection…" />
              </SelectTrigger>
              <SelectContent>
                {collections.map((collection) => (
                  <SelectItem key={collection.id} value={collection.id}>
                    {collection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          {correction === null ? null : correction.text !== undefined ? (
            <Alert>
              <PencilLine aria-hidden />
              <AlertTitle>The draft will expect your corrected answer</AlertTitle>
              <AlertDescription>
                <span className="line-clamp-6 whitespace-pre-wrap break-words">
                  {correction.text}
                </span>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <PencilLine aria-hidden />
              <AlertTitle>No corrected answer was captured</AlertTitle>
              <AlertDescription>
                The draft carries the source test’s expectations unchanged. Write a corrected answer
                in the run console first if you want the draft to expect it instead.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </FormDialog>
  );
}
