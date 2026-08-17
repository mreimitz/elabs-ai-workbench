// Tool "Run" console — a full-screen `Dialog` shell around the shared {@link ToolRunner}: a resizable
// split (parameters form LEFT, live result RIGHT) with a footer carrying the run action + token/byte/
// time KPIs. The dialog owns only its open/close + the header; all form → `tools/call` → result →
// token machinery lives in `components/ToolRunner.tsx` (also reused by the Skill IDE's runner Sheet —
// Skill IDE WP 8.5). This dialog does NOT opt into the destructive confirm, so it runs exactly as it
// always has.
import type { TokenProfileId } from "@mcp-token-footprint/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@elabs-ai/components-ui";
import { ToolRunner } from "../../components/ToolRunner";
import type { ToolParam } from "../../lib/schema-params";

export function ToolRunDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  toolName: string;
  params: ToolParam[];
  tokenProfile?: TokenProfileId;
}) {
  const { open, onOpenChange, serverId, toolName, params, tokenProfile } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="flex flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle className="truncate font-mono text-base">{toolName}</DialogTitle>
          <DialogDescription>
            Runs <code className="font-mono">tools/call</code> on the live server and measures
            request/response token cost.
          </DialogDescription>
        </DialogHeader>

        <ToolRunner
          serverId={serverId}
          toolName={toolName}
          params={params}
          tokenProfile={tokenProfile}
        />
      </DialogContent>
    </Dialog>
  );
}
