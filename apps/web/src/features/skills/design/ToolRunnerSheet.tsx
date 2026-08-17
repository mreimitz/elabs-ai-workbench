import { useEffect, useMemo, useState } from "react";
import type { BoundTool, ScanDetail, ToolScan } from "@mcp-token-footprint/shared";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatePanel,
} from "@elabs-ai/components-ui";
import { apiGet } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { parseParams, sortParams } from "../../../lib/schema-params";
import { ToolRunner } from "../../../components/ToolRunner";

/**
 * Skill IDE WP 8.5 — the inline tool-runner Sheet: the built scans playground surfaced where authors
 * work. Opened (strictly user-initiated) from the WP 8.2 hover "Test this tool…" command-link and the
 * WP 8.3 tool-card "Test run" button, both of which hand over an ALREADY-RESOLVED {@link BoundTool}
 * (`serverId` + `toolName` from the skill's binding).
 *
 * The Sheet reads the bound server's LATEST COMPLETED scan (persisted read — never opens an MCP
 * connection) to recover the tool's real input schema + annotations, builds the same schema-generated
 * form as the playground, and runs `tools/call` through the EXISTING API route (the API makes the MCP
 * call). Results are ephemeral IDE state — nothing is persisted, and closing the Sheet drops them.
 * Running a TOOL is not running SKILL content — this never touches the never-execute-skill invariant.
 */
export type ToolRunnerSheetProps = {
  /** The resolved bound tool to run, or `null` when the Sheet is closed. */
  tool: BoundTool | null;
  onClose: () => void;
};

export function ToolRunnerSheet({ tool, onClose }: ToolRunnerSheetProps) {
  const open = tool !== null;
  const serverId = tool?.serverId;
  const toolName = tool?.toolName;

  const [scan, setScan] = useState<ScanDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the bound server's latest scan once per (serverId) while the Sheet targets a tool. The tool's
  // full schema + annotations live on the scan (the bound-tools list only carries a summary), so this
  // is how the runner gets the same form + destructive flags the playground has.
  useEffect(() => {
    if (!serverId) {
      setScan(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setScan(null);
    setError(null);
    setLoading(true);
    apiGet<ScanDetail>(`/api/servers/${serverId}/latest-scan`)
      .then((detail) => {
        if (!cancelled) setScan(detail);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(getErrorMessage(err, "Couldn’t load the server’s latest scan."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  const toolScan: ToolScan | undefined = useMemo(
    () => (toolName ? scan?.tools.find((t) => t.toolName === toolName) : undefined),
    [scan, toolName],
  );

  const params = useMemo(
    () => (toolScan ? sortParams(parseParams(toolScan.inputSchema, toolScan.schemaTokens)) : []),
    [toolScan],
  );

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="flex w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <SheetHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <SheetTitle className="truncate font-mono text-base">{toolName ?? "Test run"}</SheetTitle>
          <SheetDescription>
            {tool ? (
              <>
                Runs <code className="font-mono">tools/call</code> on{" "}
                <strong>{tool.serverName}</strong> and measures request/response token cost.
              </>
            ) : (
              "Run a bound tool against its server."
            )}
          </SheetDescription>
        </SheetHeader>

        {!tool ? null : loading ? (
          <div className="grid min-h-0 flex-1 place-items-center p-4">
            <StatePanel
              kind="loading"
              title="Loading tool…"
              description="Reading the bound server's latest scan."
            />
          </div>
        ) : error ? (
          <div className="grid min-h-0 flex-1 place-items-center p-4">
            <StatePanel
              kind="error"
              title="Couldn’t load the tool — close this panel and try again."
              description={error}
            />
          </div>
        ) : !toolScan ? (
          <div className="grid min-h-0 flex-1 place-items-center p-4">
            <StatePanel
              kind="empty"
              title="Tool not in the latest scan"
              description={`“${toolName}” isn’t in ${tool.serverName}’s latest completed scan. Re-scan the server, then try again.`}
            />
          </div>
        ) : (
          <ToolRunner
            serverId={tool.serverId}
            toolName={tool.toolName}
            params={params}
            tokenProfile={scan?.tokenProfile}
            annotations={toolScan.annotations}
            confirmDestructive
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
