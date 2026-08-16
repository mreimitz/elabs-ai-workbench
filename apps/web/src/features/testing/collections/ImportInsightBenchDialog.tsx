import { useEffect, useState } from "react";
import type { Collection } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileUpload,
  FileUploadDropzone,
  Label,
  Spinner,
  Text,
  Textarea,
  type UploadFile,
} from "@brand/ui";
import { Download } from "lucide-react";
import { SelectField } from "../../../components/SelectField";
import { importInsightBench, type InsightBenchImportResult } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";

const NO_COLLECTION = "none";

/**
 * One-way InsightBench import (WP 4.4, B13). The colleague's `questions.json` is read + parsed ON THE
 * CLIENT (no multipart — that's an owner-gated dep) and POSTed as `questions`; the API converts it to
 * graded tests + one suite (idempotent server-side). Import ONLY — there is deliberately no exporter.
 * The file can be dropped/browsed (its text fills the box) or pasted directly; JSON is parsed here so a
 * malformed file is caught inline before any request.
 */
export function ImportInsightBenchDialog({
  open,
  collections,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  collections: Collection[];
  onOpenChange: (open: boolean) => void;
  /** Called with the import result so the caller can toast + refresh (and deep-link the suite). */
  onImported: (result: InsightBenchImportResult) => void;
}) {
  const [target, setTarget] = useState<string>(NO_COLLECTION);
  const [raw, setRaw] = useState("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(NO_COLLECTION);
    setRaw("");
    setFiles([]);
    setError(null);
    setImporting(false);
  }, [open]);

  function handleFiles(next: UploadFile[]) {
    const first = next[0];
    if (!first) return;
    setFiles([]);
    setError(null);
    first.file
      .text()
      .then((text) => setRaw(text))
      .catch((err: unknown) =>
        setError(`Couldn’t read the file. ${getErrorMessage(err)} Try pasting the JSON instead.`),
      );
  }

  async function submit() {
    const text = raw.trim();
    if (!text) {
      setError("Pick or paste a questions.json first.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(`That isn't valid JSON: ${getErrorMessage(err)}`);
      return;
    }

    setError(null);
    setImporting(true);
    try {
      const result = await importInsightBench(target === NO_COLLECTION ? null : target, parsed);
      onImported(result);
      onOpenChange(false);
    } catch (err) {
      setError(`Couldn’t import the questions. ${getErrorMessage(err)} Try again.`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[90vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Import InsightBench questions</DialogTitle>
          <DialogDescription>
            Convert a colleague's <span className="font-mono">questions.json</span> into graded
            tests and one suite. The file is read in your browser — nothing is uploaded except the
            parsed content. Re-importing the same file is a no-op.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex-none border-b border-border px-4 py-3">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            <SelectField
              id="import-collection"
              label="Assign to collection (optional)"
              value={target}
              options={[
                { value: NO_COLLECTION, label: "Local only — don't assign" },
                ...collections.map((c) => ({ value: c.id, label: c.name })),
              ]}
              onChange={setTarget}
            />

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-json">questions.json</Label>
              <FileUpload
                files={files}
                onFilesChange={handleFiles}
                accept="application/json,.json"
                disabled={importing}
              >
                <FileUploadDropzone browseLabel="Browse for questions.json" />
              </FileUpload>
              <Textarea
                id="import-json"
                rows={10}
                className="font-mono text-xs"
                spellCheck={false}
                value={raw}
                placeholder='…or paste the JSON here, e.g. [{ "app": "Sales", "questions": [ … ] }]'
                onChange={(event) => setRaw(event.target.value)}
              />
              <Text variant="meta" tone="muted">
                An array of app groups, or a single group / wrapper object. The importer normalizes
                the shape.
              </Text>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={importing || raw.trim().length === 0}>
            {importing ? <Spinner className="size-4" /> : <Download aria-hidden />}
            <span>{importing ? "Importing…" : "Import"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
