import { useMemo, useState } from "react";
import type { CollectionSyncResult, SyncConflict } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Spinner,
  Text,
  buttonVariants,
} from "@elabs-ai/components-ui";
import { CodeEditor, DiffEditor } from "@elabs-ai/components-editor";
import { GitMerge } from "lucide-react";
import { resolveCollection, type ConflictResolutionInput } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { READ_ONLY_OPTIONS, languageFor } from "../../../lib/monaco";

type Choice = "take-local" | "take-remote" | "edited";

/** A per-file decision: the chosen side + (for `edited`) the merged text the user authored. */
type Decision = { choice: Choice; content: string };

const CHOICE_OPTIONS: { value: Choice; label: string; hint: string; destructive: boolean }[] = [
  {
    value: "take-local",
    label: "Keep local",
    hint: "your version — discards the remote side",
    destructive: true,
  },
  {
    value: "take-remote",
    label: "Take remote",
    hint: "their version — overwrites your local side",
    destructive: true,
  },
  {
    value: "edited",
    label: "Edit merged",
    hint: "hand-merge the two into one",
    destructive: false,
  },
];

/**
 * Per-file conflict resolution (WP 4.3, B11). A conflicted sync surfaces a list of {@link SyncConflict}
 * (path + both parsed sides). For each file the operator picks take-local / take-remote / edit-merged;
 * the two sides render side-by-side in a read-only Monaco `DiffEditor` (the same diff composition the
 * skills diff uses), and `edit-merged` swaps in an editable `CodeEditor` seeded with the local side.
 * Resolving is DESTRUCTIVE (it discards the unchosen side and pushes a merge commit — never a
 * force-push), so it's gated behind an `AlertDialog` confirm. On success the caller re-reads status.
 */
export function ConflictResolution({
  collectionId,
  conflicts,
  onResolved,
}: {
  collectionId: string;
  conflicts: SyncConflict[];
  onResolved: (result: CollectionSyncResult) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resolving, setResolving] = useState(false);

  const allDecided = useMemo(
    () => conflicts.every((conflict) => decisions[conflict.path] !== undefined),
    [conflicts, decisions],
  );
  const anyDestructive = useMemo(
    () =>
      Object.values(decisions).some((d) => d.choice === "take-local" || d.choice === "take-remote"),
    [decisions],
  );

  function choose(conflict: SyncConflict, choice: Choice) {
    setDecisions((prev) => {
      const existing = prev[conflict.path];
      // Seed the editable buffer with the local side the first time "Edit merged" is picked.
      const content = choice === "edited" ? (existing?.content ?? conflict.local) : "";
      return { ...prev, [conflict.path]: { choice, content } };
    });
  }

  function editMerged(path: string, content: string) {
    setDecisions((prev) => {
      const existing = prev[path];
      if (!existing) return prev;
      return { ...prev, [path]: { ...existing, content } };
    });
  }

  async function resolve() {
    setConfirming(false);
    const resolutions: ConflictResolutionInput[] = conflicts.map((conflict) => {
      const decision = decisions[conflict.path];
      const choice = decision?.choice ?? "take-remote";
      return choice === "edited"
        ? {
            path: conflict.path,
            resolution: "edited",
            content: decision?.content ?? conflict.local,
          }
        : { path: conflict.path, resolution: choice };
    });

    setError(null);
    setResolving(true);
    try {
      const result = await resolveCollection(collectionId, resolutions);
      onResolved(result);
    } catch (err) {
      setError(`Couldn’t resolve the merge. ${getErrorMessage(err)} Try again.`);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="warning">
        <AlertDescription>
          This branch has {conflicts.length} conflicted file{conflicts.length === 1 ? "" : "s"}.
          Choose a side (or hand-merge) for each, then resolve to finish the merge and push.
        </AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-4">
        {conflicts.map((conflict) => {
          const decision = decisions[conflict.path];
          return (
            <li key={conflict.path}>
              <Card>
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="min-w-0 break-all font-mono text-sm">
                      {conflict.path}
                    </CardTitle>
                    {decision ? (
                      <Badge variant={decision.choice === "edited" ? "info" : "secondary"}>
                        {CHOICE_OPTIONS.find((o) => o.value === decision.choice)?.label}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">unresolved</Badge>
                    )}
                  </div>
                  <RadioGroup
                    value={decision?.choice ?? ""}
                    onValueChange={(value) => choose(conflict, value as Choice)}
                    className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
                  >
                    {CHOICE_OPTIONS.map((option) => {
                      const id = `${conflict.path}:${option.value}`;
                      return (
                        <Label
                          key={option.value}
                          htmlFor={id}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
                        >
                          <RadioGroupItem id={id} value={option.value} />
                          <span className="flex flex-col">
                            <span className="text-sm font-medium">{option.label}</span>
                            <Text variant="meta" tone="muted">
                              {option.hint}
                            </Text>
                          </span>
                        </Label>
                      );
                    })}
                  </RadioGroup>
                </CardHeader>
                <CardContent>
                  {decision?.choice === "edited" ? (
                    <div className="flex flex-col gap-1.5">
                      <Text variant="meta" tone="muted">
                        Merged result — edit freely; this exact text is committed.
                      </Text>
                      <div className="h-72 overflow-hidden rounded-md border border-border">
                        <CodeEditor
                          value={decision.content}
                          language={languageFor(conflict.path)}
                          height="100%"
                          ariaLabel={`Merged ${conflict.path}`}
                          onChange={(value) => editMerged(conflict.path, value ?? "")}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Text variant="meta" tone="muted">
                          Local (yours)
                        </Text>
                        <Text variant="meta" tone="muted">
                          Remote (theirs)
                        </Text>
                      </div>
                      <div className="h-72 overflow-hidden rounded-md border border-border">
                        <DiffEditor
                          original={conflict.local}
                          modified={conflict.remote}
                          language={languageFor(conflict.path)}
                          readOnly
                          height="100%"
                          options={READ_ONLY_OPTIONS}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!allDecided ? (
          <Text variant="meta" tone="muted">
            Choose a resolution for every file to continue.
          </Text>
        ) : null}
        <Button disabled={!allDecided || resolving} onClick={() => setConfirming(true)}>
          {resolving ? <Spinner className="size-4" /> : <GitMerge aria-hidden />}
          <span>{resolving ? "Resolving…" : "Resolve & sync"}</span>
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Resolve {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {anyDestructive
                ? "This discards the unchosen side of each file, commits the merge, and pushes it (never a force-push). It can't be undone from here."
                : "This commits your hand-merged result and pushes it (never a force-push)."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => void resolve()}
            >
              Resolve &amp; push
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
