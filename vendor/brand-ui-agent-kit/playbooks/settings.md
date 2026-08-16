# Playbook — Settings / admin portal

Multi-section settings: sectioned nav, forms per section, guarded
destructive actions. Template source: `templates/settings.tsx` (generated from this Storybook story by `pnpm gen:templates`).

## Building blocks

| Layer    | Components                                                                       | From          |
| -------- | -------------------------------------------------------------------------------- | ------------- |
| Shell    | `SidebarProvider` + `Sidebar` (sections) + `SidebarInset`                        | `@brand/ui`   |
| Sections | one view component per section, switched by nav (or `Tabs` for ≤4 flat sections) | `@brand/ui`   |
| Forms    | `Card` + `Label` + `Input` / `Switch` / `Select` / `RadioGroup`                  | `@brand/ui`   |
| Display  | `Descriptions` + `DescriptionsItem` (read-only field groups) · `Badge` (status)  | `@brand/ui`   |
| Flows    | `Wizard` + `WizardSteps` + `WizardStep` + `WizardNav` (multi-step setup)         | `@brand/ui`   |
| Guard    | `AlertDialog` (destructive) · `Dialog` (focused sub-forms like change-password)  | `@brand/ui`   |
| Data     | `DataTable` for embedded record lists (active sessions, API keys)                | `@brand/data` |

## Wiring diagram

```
SidebarProvider
├── Sidebar — one item per section (Profile / Notifications / Security / …)
└── SidebarInset > main (max-w-2xl p-6)        ← settings stay readable, not full-width
    └── views[active]
        ├── read-only info     → Card > Descriptions
        ├── editable group     → Card > Label+control rows + Save button
        ├── multi-step setup   → Card > Wizard
        └── danger zone        → Card > destructive Button + AlertDialog
```

## Form pattern (per section)

One save button per card, dirty-gated:

```tsx
const [values, setValues] = useState(initial);
const isDirty = !isEqual(values, initial);
const [saving, setSaving] = useState(false);

<div className="flex items-center justify-between">
  <Label htmlFor="weekly-digest">Weekly digest</Label>
  <Switch id="weekly-digest" checked={values.digest}
    onCheckedChange={(v) => setValues({ ...values, digest: v })} />
</div>
<Button size="sm" disabled={!isDirty || saving} onClick={save}>
  {saving ? "Saving…" : "Save preferences"}
</Button>
```

Form hygiene (from `interaction-guidelines.md`): every `Input` gets
`autocomplete` + correct `type`; errors render **inline next to the field**
(`role="alert"`), focus the first error on submit; never block paste; warn
before navigating away with unsaved changes.

## Destructive actions

The multi-step pattern, always:

```
destructive Button (variant="destructive")
→ AlertDialog: consequence list + explicit verb ("Revoke 4 sessions")
→ confirm → request with spinner → result
```

Never destructive-on-click. Per-row destructive actions in an embedded
`DataTable` (revoke session, delete key) follow the same gate.

## Decisions you own

Section list · fields per section (name, control type, validation rule) ·
which actions are destructive and their consequence copy · wizard vs. flat
form for onboarding · theme.

## Decisions already made — don't re-make

Sidebar-switched sections (scales past 4; `Tabs` only for small flat sets) ·
`max-w-2xl` content column · one save per card, dirty-gated, spinner while
saving · `Descriptions` for read-only data · `AlertDialog` (not `Dialog`)
for confirmations.

## Common mistakes

- Toasting validation errors instead of inline `role="alert"` next to the field.
- A global save for all sections — save scope is the card.
- `Dialog` for a destructive confirm — `AlertDialog` has the right semantics
  and focus behavior.
- Native checkboxes for preference toggles — `Switch` + `Label` share one
  hit target.
