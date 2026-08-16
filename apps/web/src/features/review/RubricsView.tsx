import { useCallback, useEffect, useState } from "react";
import type { ReviewRubric } from "@mcp-token-footprint/shared";
import {
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Heading,
  StatePanel,
  Text,
  buttonVariants,
  toast,
} from "@brand/ui";
import { ClipboardList, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
import { deleteReviewRubric, listReviewRubrics } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { RubricEditorDialog, type RubricEditorMode } from "./RubricEditorDialog";
import { notifyError } from "../../lib/notify";

/**
 * Review-rubric management (Observability WP4.5, D-OB22) — reached from the "Review rubrics" nav item
 * in the Setup group (design-remediation T8), the Collections page's Review card, or Settings →
 * Testing, mirroring `WatchRulesView`'s list/editor/delete shape. A rubric is the ONLY thing this WP
 * persists (`review_rubrics`) — the review SESSION itself (a source filter + a picked rubric) is
 * ephemeral, chosen at review time on the `/testing/review` surface.
 */
export function RubricsView() {
  const [rubrics, setRubrics] = useState<ReviewRubric[]>([]);
  const [loading, setLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<RubricEditorMode>("create");
  const [editorRubric, setEditorRubric] = useState<ReviewRubric | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ReviewRubric | null>(null);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    try {
      const list = await listReviewRubrics();
      if (isActive()) setRubrics(list);
    } catch (error) {
      if (isActive())
        notifyError("Couldn’t load review rubrics. Reload the page to try again.", {
          description: getErrorMessage(error),
        });
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  function openCreate() {
    setEditorMode("create");
    setEditorRubric(null);
    setEditorOpen(true);
  }

  function openEdit(rubric: ReviewRubric) {
    setEditorMode("edit");
    setEditorRubric(rubric);
    setEditorOpen(true);
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteReviewRubric(target.id);
      toast.success("Rubric deleted");
      await load();
    } catch (error) {
      notifyError("Couldn’t delete the rubric. Try again.", {
        description: getErrorMessage(error),
      });
    }
  }

  return (
    <PageShell
      headerVariant="toolbar"
      width="full"
      header={
        <ViewToolbar
          info={
            <p className="max-w-xs text-pretty">
              A rubric is a checklist a reviewer walks for every run — each key becomes one question
              (thumbs, a 1–5 scale, or a note). Every answer is written as ordinary human feedback on
              the run, never a grade.
            </p>
          }
          actions={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              <span>New rubric</span>
            </Button>
          }
        />
      }
    >
      <Heading level={1} className="sr-only">
        Review rubrics
      </Heading>

      {loading ? (
        <StatePanel kind="loading" title="Loading rubrics…" loadingLabel="Loading rubrics…" />
      ) : rubrics.length === 0 ? (
        <EmptyState
          icon={<ClipboardList aria-hidden />}
          title="No review rubrics yet"
          description="Create a rubric, then pick it from the runs feed's “Review these…” button to walk a filtered set of runs keyboard-first."
          actions={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              <span>New rubric</span>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rubrics.map((rubric) => (
            <li key={rubric.id}>
              <RubricRow rubric={rubric} onEdit={() => openEdit(rubric)} onDelete={() => setPendingDelete(rubric)} />
            </li>
          ))}
        </ul>
      )}

      <RubricEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        mode={editorMode}
        rubric={editorRubric}
        onSaved={() => void load()}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name ?? "rubric"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the rubric definition only. Every answer a reviewer already recorded stays
              on its run as ordinary human feedback — deleting a rubric never touches it. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => void performDelete()}
            >
              Delete rubric
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function RubricRow({
  rubric,
  onEdit,
  onDelete,
}: {
  rubric: ReviewRubric;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text className="min-w-0 truncate font-medium">{rubric.name}</Text>
            <Badge variant="secondary" className="tabular-nums">
              {rubric.keys.length} key{rubric.keys.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <Text variant="meta" tone="muted" className="min-w-0 truncate">
            {rubric.keys.map((k) => k.key).join(", ")}
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            <span>Edit</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="ghost" size="icon-sm" label={`More actions for ${rubric.name}`}>
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 aria-hidden />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
