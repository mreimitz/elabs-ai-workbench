import type { ReactNode } from "react";
import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@elabs-ai/components-ui";
import { MoreHorizontal, Rocket } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { CrewCard } from "./CrewCard";

/**
 * Assistant Hub UX WP2.2 (D-HUX5 §7.3 Tab 1) — the crew-scope header: `CrewCard`'s identity/stats
 * treatment plus the two crew-level actions the concept calls out — "Instantiate" (start a new
 * mission session with this crew, the primary action) and the same "⋯ = open profile" pattern every
 * other card in this tab follows (D-HUX5). Session creation itself (the actual `POST /api/hub/sessions`
 * + navigate) stays with the caller (`DirectoryTab`, which already owns `useNavigate` for the node
 * routes) — this component only renders the trigger and an honest disabled reason when instantiation
 * isn't currently possible (no model resolvable).
 *
 * NOTE on scope: the concept prose also mentions "crew budgets" on this card; `HubCrew` carries no
 * crew-level budgets field on the wire (only per-MEMBER budget overrides) and D-HUX16 keeps wire
 * changes additive-only within their owning WP — that summary is intentionally omitted here rather
 * than invented.
 */
export function CrewHeaderCard(props: {
  crew: HubCrew;
  roles: HubAgentRole[];
  /** Crew nesting (WP4.2 / D-CN8) — the FULL crew library, threaded to `CrewCard` so it can resolve a
   *  `crewId` member's name and compute the crew's recursive membership count. */
  crews: HubCrew[];
  onOpenProfile: () => void;
  onInstantiate: () => void;
  instantiateBusy?: boolean;
  /** Non-null disables Instantiate with an honest reason (e.g. "no model configured yet"). */
  instantiateDisabledReason?: string | null;
  /** D-MI7 (WP 4.1) — an optional model picker for the coordinating session Instantiate starts, so
   *  WHICH model (and credential) it runs on is visible and changeable rather than silently the
   *  roster's first row. Rendered immediately before the Instantiate button. */
  instantiateModelPicker?: ReactNode;
}) {
  const {
    crew,
    roles,
    crews,
    onOpenProfile,
    onInstantiate,
    instantiateBusy,
    instantiateDisabledReason,
    instantiateModelPicker,
  } = props;
  const instantiateDisabled = instantiateBusy || !!instantiateDisabledReason;

  const instantiateButton = (
    <Button type="button" onClick={onInstantiate} disabled={instantiateDisabled}>
      {instantiateBusy ? (
        <Spinner className="size-4" aria-hidden />
      ) : (
        <Rocket aria-hidden className="size-4" />
      )}
      <span>Instantiate</span>
    </Button>
  );

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <CrewCard crew={crew} roles={roles} crews={crews} className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-1.5">
          {instantiateModelPicker ? (
            <span className="w-56 shrink-0">{instantiateModelPicker}</span>
          ) : null}
          {instantiateDisabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block shrink-0">{instantiateButton}</span>
              </TooltipTrigger>
              <TooltipContent>{instantiateDisabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            instantiateButton
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton type="button" variant="ghost" size="icon-sm" label={`${crew.name} actions`}>
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpenProfile}>Open profile</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}
