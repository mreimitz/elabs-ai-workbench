import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Text,
  Textarea,
} from "@brand/ui";
import { Plus, Wand2 } from "lucide-react";

/**
 * A `/command` token: one leading slash + a word/kebab token. Mirrors the WP 2.2 client-side guard
 * `/^\/[a-z0-9][a-z0-9-]*$/i` — a friendlier subset of the API's `/^\/\S+$/` (the API stays
 * authoritative: its 400 still surfaces in the Save dialog if a token slips past this).
 */
export const COMMAND_TOKEN_PATTERN = /^\/[a-z0-9][a-z0-9-]*$/i;

export type CommandDialogInput = { command: string; title?: string; body?: string };

export type CommandDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "add" seeds a brand-new command (token + optional title/body); "rename" edits only the token. */
  mode: "add" | "rename";
  /** rename mode: the token to prefill (e.g. "/report"). */
  initialCommand?: string;
  /** Existing `/command` tokens for a client-side duplicate warning (the API is authoritative). In
   *  rename mode, exclude the command being renamed. */
  existingCommands?: string[];
  /** Stages the op (the caller composes `add_command` / `rename_command`). Only ever called with a
   *  token that passed {@link COMMAND_TOKEN_PATTERN}. */
  onSubmit: (input: CommandDialogInput) => void;
};

/**
 * The command authoring dialog (Skill IDE WP 2.2): create a new `/command` (toolbar "Add command")
 * or rename an existing one (entry-point node panel). Validates the token client-side and surfaces a
 * duplicate warning inline; nothing mutates here — the caller stages a typed op that rides the same
 * preview + Save flow as every other edit.
 */
export function CommandDialog({
  open,
  onOpenChange,
  mode,
  initialCommand,
  existingCommands = [],
  onSubmit,
}: CommandDialogProps) {
  const [command, setCommand] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) {
      setCommand(mode === "rename" ? (initialCommand ?? "") : "");
      setTitle("");
      setBody("");
    }
  }, [open, mode, initialCommand]);

  const trimmed = command.trim();
  const tokenValid = COMMAND_TOKEN_PATTERN.test(trimmed);
  const duplicate = useMemo(
    () =>
      tokenValid &&
      existingCommands.some((existing) => existing.toLowerCase() === trimmed.toLowerCase()),
    [tokenValid, existingCommands, trimmed],
  );
  const unchanged = mode === "rename" && trimmed === (initialCommand ?? "").trim();
  const canSubmit = trimmed !== "" && tokenValid && !duplicate && !unchanged;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      command: trimmed,
      ...(mode === "add" && title.trim() ? { title: title.trim() } : {}),
      ...(mode === "add" && body.trim() ? { body: body.trim() } : {}),
    });
    onOpenChange(false);
  };

  const isAdd = mode === "add";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>{isAdd ? "Add command" : "Rename command"}</DialogTitle>
          <DialogDescription>
            {isAdd
              ? "Stages an `add_command` op — a new `## /command` section starts its own flow lane when you save."
              : "Stages a `rename_command` op — only the `/command` token in the heading changes when you save."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="command-token">Command</Label>
            <Input
              id="command-token"
              name="command"
              value={command}
              placeholder="/report…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={trimmed !== "" && (!tokenValid || duplicate) ? true : undefined}
              aria-describedby="command-token-help"
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            {trimmed !== "" && !tokenValid ? (
              <Text
                id="command-token-help"
                variant="meta"
                className="text-destructive"
                role="alert"
              >
                A command is a single /token — letters, numbers or hyphens, e.g. /report or
                /daily-report.
              </Text>
            ) : duplicate ? (
              <Text
                id="command-token-help"
                variant="meta"
                className="text-destructive"
                role="alert"
              >
                A command with this token already exists — pick a unique token.
              </Text>
            ) : (
              <Text id="command-token-help" variant="meta" tone="muted">
                One leading slash, then a word or kebab token (e.g. /report).
              </Text>
            )}
          </div>

          {isAdd ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="command-title">Section title (optional)</Label>
                <Input
                  id="command-title"
                  name="title"
                  value={title}
                  placeholder="Produce the daily report…"
                  onChange={(event) => setTitle(event.target.value)}
                />
                <Text variant="meta" tone="muted">
                  Shown after the `/command` in the heading; defaults to the token alone.
                </Text>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="command-body">Body (optional)</Label>
                <Textarea
                  id="command-body"
                  name="body"
                  rows={5}
                  value={body}
                  placeholder="What this command should do…"
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {isAdd ? <Plus aria-hidden /> : <Wand2 aria-hidden />}
            {isAdd ? "Add command" : "Rename command"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
