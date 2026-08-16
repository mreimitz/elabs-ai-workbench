# Archetype mapping (description → template + playbook + stage-6 questions)

## Recognition table

Map the user's plain language — they should never need component names.

| The user says (signals)                                                        | Archetype      | Template (`npx shadcn add …`) | Playbook                      |
| ------------------------------------------------------------------------------ | -------------- | ----------------------------- | ----------------------------- |
| KPIs, metrics, trends, charts, "overview", "pipeline", "at-a-glance"           | Dashboard      | `template-dashboard`          | `playbooks/dashboard.md`      |
| browse/manage records, logs, admin console, back-office, filters, bulk actions | Data app       | `template-data-app`           | `playbooks/data-app.md`       |
| chat, assistant, copilot, agent, Q&A, "talks to my model", citations, tools    | AI assistant   | `template-ai-assistant`       | `playbooks/ai-assistant.md`   |
| pipeline editor, workflow, nodes/edges, canvas, drag-and-drop graph, ETL       | Flow workspace | `template-flow-workspace`     | `playbooks/flow-workspace.md` |
| settings, preferences, account, profile, admin portal, configuration           | Settings       | `template-settings`           | `playbooks/settings.md`       |
| landing page, pitch, presales demo page, "marketing site", hero, CTA           | Marketing      | `template-marketing`          | `playbooks/marketing.md`      |

Mixed asks ("dashboard with a chat sidebar"): pick the **primary surface**
as the archetype, add the secondary via its playbook's blocks. Multi-surface
apps (stage 3 lists several): one archetype per surface, shared app shell.

## Stage-6 question sets (full mode, per archetype)

Ask only what the spec doesn't already answer; ≤4 questions per round.

**Dashboard** — ① the 3–5 KPIs (label + what it measures + is down good?)
② chart questions ("compare quarters" → bar; "trend over time" → line/area;
"share of total" → ring) ③ table below? (columns) ④ default time range.

**Data app** — ① entity name + fields (name : type, where type ∈ text ·
number · date · status · boolean) ② which fields filter (facets) vs. search
③ row actions + which are destructive ④ data size (>10k rows → server-side
pagination or virtualization).

**AI assistant** — ① which parts the agent emits: reasoning / tool calls /
citations (multi-select) ② sidebar: history · settings-only · none
③ suggested prompts for the empty state ④ runtime: AI SDK `useChat`
(streaming) or one-shot endpoint.

**Flow workspace** — ① node categories (name + tone each; ≤5)
② inspector fields per category (or "defaults, I'll refine in code")
③ editable or read-only canvas ④ what runs the pipeline (toolbar actions).

**Settings** — ① section list ② per section: fields (name + control:
input/switch/select/radio) ③ destructive actions + consequence copy
④ onboarding wizard needed?

**Marketing** — ① headline + subheadline (offer to draft) ② 3–4 stats
③ feature list (≤6) ④ CTA label + target; standalone or embedded.

## Per-archetype defaults (used when stage 6 is skipped / quick mode)

| Archetype      | Defaults recorded into the spec                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Dashboard      | 4 KPI tiles · bar + line chart row · no table · `columns={4}`                                      |
| Data app       | template's sample entity kept as typed placeholder · client pagination, 25/page · search + 1 facet |
| AI assistant   | text-only parts · history sidebar · 3 suggested prompts · `useChat` stub                           |
| Flow workspace | source/process/output taxonomy (template's) · editable · inspector with name field                 |
| Settings       | Profile + Notifications + Security sections (template's) · no wizard                               |
| Marketing      | template's section order · 4 stats · 6 features · single CTA                                       |

Theme default: `qlik-bright`. Nav default: sidebar with one item per surface
(marketing: top nav instead).
