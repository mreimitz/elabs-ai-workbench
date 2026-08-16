/* GENERATED from packages/marketing/src/templates-marketing.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen marketing template (single source of truth: the Storybook story). */

/**
 * Marketing landing template — the canonical full-screen presales/landing
 * composition: sticky nav + Hero + StatsBand + FeatureGrid + UseCaseCard row +
 * LogoStrip + CTASection + footer (the standard section order). This story is
 * the single source of truth: `pnpm gen:templates` derives the consumer
 * template source (`docs/playbooks/templates/marketing.tsx`) from it.
 *
 * Verify across all three themes with globals=theme:<slug>
 * (qlik-bright | qlik-dark | blueprint).
 *
 * The marketing package ships no icons by design (sections take `icon?:
 * ReactNode` from the consumer), so this story passes inline currentColor
 * glyphs — the same way a consumer would hand in Lucide / @brand/icons.
 */
import { Badge, Button } from "@brand/ui";
import {
  CTASection,
  FeatureGrid,
  Hero,
  LogoStrip,
  StatsBand,
  UseCaseCard,
  type Feature,
  type Stat,
} from "@brand/marketing";

// ---------------------------------------------------------------------------
// Decorative glyphs — inline, currentColor, sized by the host (`[&_svg]:size-5`)
// ---------------------------------------------------------------------------

function Glyph({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const GLYPHS = {
  sparkles: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3z M18 16l.8 2 .2.8.2-.8.8-2",
  database:
    "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6",
  message: "M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z",
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9.5 12l1.8 1.8L15 10",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M20 20H3",
  cloud: "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1A3.5 3.5 0 0 1 17 18z",
  cart: "M3 4h2l2.2 11.2A2 2 0 0 0 9.2 17H17a2 2 0 0 0 2-1.6L20.5 8H6 M9 21h.01 M16 21h.01",
  bank: "M3 10l9-5 9 5 M5 10v8 M9 10v8 M15 10v8 M19 10v8 M3 21h18",
  factory: "M3 21V9l5 3V9l5 3V9l5 3v9z M7 15h.01 M12 15h.01 M17 15h.01",
} as const;

// ---------------------------------------------------------------------------
// Sample content
// ---------------------------------------------------------------------------

const stats: Stat[] = [
  { value: "38,000+", label: "customers worldwide" },
  { value: "100B+", label: "queries per month" },
  { value: "60%", label: "faster time to insight" },
  { value: "99.9%", label: "platform uptime" },
];

const features: Feature[] = [
  {
    title: "AI-powered analytics",
    description: "Surface insights automatically with ML-driven suggestions and anomaly detection.",
    icon: <Glyph d={GLYPHS.sparkles} />,
  },
  {
    title: "Real-time data integration",
    description: "Stream from any source to live dashboards with change-data-capture pipelines.",
    icon: <Glyph d={GLYPHS.database} />,
  },
  {
    title: (
      <span className="inline-flex items-center gap-2">
        Natural language queries <Badge variant="secondary">New</Badge>
      </span>
    ),
    description: "Ask questions in plain language and get governed, explainable answers.",
    icon: <Glyph d={GLYPHS.message} />,
  },
  {
    title: "Governed self-service",
    description: "Central governance with self-service freedom — one trusted semantic layer.",
    icon: <Glyph d={GLYPHS.shield} />,
  },
  {
    title: "Embedded analytics",
    description: "Embed interactive visualizations into your own products and portals.",
    icon: <Glyph d={GLYPHS.chart} />,
  },
  {
    title: "Cloud & on-prem",
    description: "Run fully managed in the cloud or deploy on your own infrastructure.",
    icon: <Glyph d={GLYPHS.cloud} />,
  },
];

const useCases = [
  {
    tag: "Retail",
    title: "Inventory & demand intelligence",
    description:
      "Unify POS, supply chain, and e-commerce data to forecast demand and cut stockouts.",
    icon: <Glyph d={GLYPHS.cart} />,
  },
  {
    tag: "Financial services",
    title: "Risk & compliance analytics",
    description:
      "Monitor exposure in real time with governed, auditable dashboards for every desk.",
    icon: <Glyph d={GLYPHS.bank} />,
  },
  {
    tag: "Manufacturing",
    title: "Operational performance",
    description:
      "Connect shop-floor telemetry to business KPIs and catch deviations before they cost.",
    icon: <Glyph d={GLYPHS.factory} />,
  },
];

const logos = Array.from({ length: 6 }, (_, i) => (
  <div
    key={i}
    aria-hidden="true"
    className="flex h-7 w-24 items-center justify-center rounded border border-dashed text-meta text-muted-foreground"
  >
    Logo {i + 1}
  </div>
));

// ---------------------------------------------------------------------------
// Page composition
// ---------------------------------------------------------------------------

function MarketingLandingTemplate() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <nav
          aria-label="Main"
          className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"
        >
          <a href="#" aria-label="Home" className="flex items-center gap-2 font-semibold">
            <span className="grid size-7 place-items-center rounded bg-primary text-primary-foreground [&_svg]:size-4">
              <Glyph d={GLYPHS.sparkles} />
            </span>
            Acme Analytics
          </a>
          <div className="hidden items-center gap-6 text-body sm:flex">
            <a className="text-muted-foreground hover:text-foreground" href="#features">
              Platform
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="#use-cases">
              Solutions
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="#cta">
              Resources
            </a>
          </div>
          <Button size="sm">Book a demo</Button>
        </nav>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-24 px-6 py-16">
        <Hero
          eyebrow="Now with AI-assisted insights"
          title="Intelligent analytics for every decision"
          description="Give your team AI-powered insights at the speed of thought — governed, explainable, and on any data."
          actions={
            <>
              <Button size="lg">See the platform</Button>
              <Button size="lg" variant="outline">
                Book a demo
              </Button>
            </>
          }
        />

        <StatsBand stats={stats} />

        <section id="features" aria-label="Platform capabilities" className="scroll-mt-20">
          <FeatureGrid features={features} columns={3} />
        </section>

        <section
          id="use-cases"
          aria-label="Industry use cases"
          className="grid scroll-mt-20 gap-6 lg:grid-cols-3"
        >
          {useCases.map((u) => (
            <UseCaseCard
              key={u.tag}
              tag={u.tag}
              title={u.title}
              description={u.description}
              icon={u.icon}
              footer="Learn more →"
            />
          ))}
        </section>

        <LogoStrip logos={logos} caption="Trusted by data-driven teams" />

        <section id="cta" aria-label="Get started" className="scroll-mt-20">
          <CTASection
            title="Ready to see it in action?"
            description="Get a guided walkthrough tailored to your data and your questions."
            actions={
              <Button size="lg" variant="secondary">
                Schedule a demo
              </Button>
            }
          />
        </section>
      </main>

      <footer className="border-t py-8 text-center text-body text-muted-foreground">
        © Acme Analytics — sample presales landing page.
      </footer>
    </div>
  );
}
