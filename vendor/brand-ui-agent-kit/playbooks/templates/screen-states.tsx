/* GENERATED from packages/ui/src/templates-screen-states.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen screen-states template (single source of truth: the Storybook story). */

/**
 * Screen States — the full state grid the templates omit.
 *
 * `design-first` requires that empty, loading, error and first-run states are
 * designed WITH the happy path, never retrofitted — yet every existing
 * `Patterns/Templates/*` ships only a populated "Ready" variant. This scenario
 * fixes that: ONE representative data screen (Customers), rendered across the
 * complete state grid as separate stories, with the SAME chrome and the real
 * state primitives wired in:
 *
 *   • Ready     — populated Table (the happy path).
 *   • Loading   — Skeleton rows (never a bare spinner on a data screen).
 *   • Empty     — StatePanel kind="empty" after a filter returns nothing.
 *   • Error     — StatePanel kind="error" with a retry action (role="alert").
 *   • FirstRun  — onboarding empty: illustration slot + one sentence + one CTA.
 *
 * Compose-only from @brand/* primitives; semantic tokens only; reads in all
 * three themes. Verify with globals=theme:<slug>.
 */
import { Inbox, Plus, RotateCcw, Search, UploadCloud, UserPlus } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  PageShell,
  SectionHeader,
  Skeleton,
  StatePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toaster,
  toast,
} from "@brand/ui";

type ScreenState = "ready" | "loading" | "empty" | "error" | "first-run";

type CustomerStatus = "active" | "trialing" | "past_due";

interface Customer {
  id: string;
  name: string;
  plan: string;
  status: CustomerStatus;
  mrr: string;
  joined: string;
}

const STATUS_VARIANT: Record<CustomerStatus, "success" | "secondary" | "destructive"> = {
  active: "success",
  trialing: "secondary",
  past_due: "destructive",
};

const STATUS_LABEL: Record<CustomerStatus, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
};

const CUSTOMERS: Customer[] = [
  {
    id: "1",
    name: "Northwind Traders",
    plan: "Enterprise",
    status: "active",
    mrr: "$4,200",
    joined: "Jan 2024",
  },
  {
    id: "2",
    name: "Globex Corp",
    plan: "Business",
    status: "active",
    mrr: "$1,800",
    joined: "Mar 2024",
  },
  { id: "3", name: "Initech", plan: "Business", status: "trialing", mrr: "$0", joined: "Jun 2026" },
  {
    id: "4",
    name: "Hooli",
    plan: "Enterprise",
    status: "past_due",
    mrr: "$6,500",
    joined: "Sep 2023",
  },
  {
    id: "5",
    name: "Soylent Inc",
    plan: "Starter",
    status: "active",
    mrr: "$240",
    joined: "Feb 2025",
  },
];

/* -------------------------------------------------------------------------- */
/*  Chrome shared by every state                                               */
/* -------------------------------------------------------------------------- */

function Toolbar({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="relative w-full max-w-xs">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search customers…"
          aria-label="Search customers"
          className="ps-8"
        />
      </div>
      <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
        {count} customers
      </span>
    </div>
  );
}

function CustomersTable() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-end">MRR</TableHead>
            <TableHead>Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CUSTOMERS.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="text-muted-foreground">{c.plan}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
              </TableCell>
              <TableCell className="text-end tabular-nums">{c.mrr}</TableCell>
              <TableCell className="text-muted-foreground">{c.joined}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-busy="true">
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <ul>
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3 [&:not(:first-child)]:border-t">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-14" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The screen — one body per state                                            */
/* -------------------------------------------------------------------------- */

function CustomersScreen({ state = "ready" }: { state?: ScreenState }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <PageShell
        header={
          <SectionHeader
            eyebrow="Billing"
            title="Customers"
            description="Everyone with an active or trialing subscription."
            actions={
              state === "first-run" ? undefined : (
                <Button size="sm" onClick={() => toast.success("New-customer form opened")}>
                  <Plus className="size-4" aria-hidden="true" />
                  New customer
                </Button>
              )
            }
          />
        }
      >
        {(state === "ready" || state === "empty") && (
          <Toolbar count={state === "ready" ? CUSTOMERS.length : 0} />
        )}

        {state === "ready" && <CustomersTable />}

        {state === "loading" && <LoadingTable />}

        {state === "error" && (
          <StatePanel
            kind="error"
            title="Couldn't load customers"
            description="The billing service didn't respond. Your data is safe — this is a display error."
            actions={
              <Button variant="outline" size="sm" onClick={() => toast.success("Retrying…")}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            }
          />
        )}

        {state === "empty" && (
          <StatePanel
            kind="empty"
            icon={<Inbox aria-hidden="true" />}
            title="No customers match"
            description="No customers match your current search or filters."
            actions={
              <Button variant="outline" size="sm">
                Clear filters
              </Button>
            }
          />
        )}

        {state === "first-run" && (
          <StatePanel
            kind="empty"
            icon={<UserPlus aria-hidden="true" />}
            title="Add your first customer"
            description="Customers appear here once they start a subscription. Add one manually or import an existing book of business."
            actions={
              <>
                <Button size="sm" onClick={() => toast.success("New-customer form opened")}>
                  <Plus className="size-4" aria-hidden="true" />
                  New customer
                </Button>
                <Button variant="outline" size="sm">
                  <UploadCloud className="size-4" aria-hidden="true" />
                  Import CSV
                </Button>
              </>
            }
          />
        )}
      </PageShell>
      <Toaster />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stories — one per state                                                     */
/* -------------------------------------------------------------------------- */

/** Populated happy path. */

/** In-flight load — Skeleton rows, not a bare spinner. */

/** A search/filter returned nothing — a real empty state with a way out. */

/** Recoverable failure — StatePanel kind="error" (role="alert") + retry. */

/** Never-used screen — onboarding empty with one primary action. */
