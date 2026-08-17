import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Collection } from "@mcp-token-footprint/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { FormDialog } from "../../components/dialogs";
import { FieldRow } from "../../components/FieldRow";
import { listCollections, promoteRunToTest } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

/**
 * Console "Promote to test" (D-OB21) — the collection picker reached from the run console's overflow
 * menu on any TERMINAL run (`RunBar`'s "Promote to test…" item). Calls the same domain path WP4.1's
 * `promote_to_test` watch action uses, on demand for one run (see `lib/api.ts`'s `promoteRunToTest`
 * doc — the backing route is a STUBBED follow-up; this dialog + client call are ready for it).
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

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setLoading(true);
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
    return () => {
      active = false;
    };
  }, [open]);

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
        description: `Promoted into ${collectionName}.`,
        action: {
          label: "Open collection",
          onClick: () => navigate(`/testing/collections/${collectionId}`),
        },
        // Interface Craft WP 3.1 (finding 5, D-IC7): an actionable toast must not expire (WCAG
        // 2.2.1) — the operator needs time to notice and use "Open collection".
        duration: Infinity,
      });
      void result;
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
      )}
    </FormDialog>
  );
}
