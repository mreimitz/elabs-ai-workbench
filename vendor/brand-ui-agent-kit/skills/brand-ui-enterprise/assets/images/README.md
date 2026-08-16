# skill/assets/images — do/don't & pattern visuals

Teaching visuals for the enterprise principles. **Reused as-is** from the
`business_app_universal_ui_rulebook` (the "reuse now" decision, ADR-0003). Most are
documentation examples from **Ant Design** and **Clarity Design System**; four are
local recreations of Clarity form SVGs; two are synthesis diagrams. Per-file source
URLs + status are in `manifest.csv`.

> ⚠️ **Reuse now, regenerate later.** These are third-party documentation screenshots,
> not brand-ui surfaces. Replace them with original, token-correct **brand-ui**
> screenshots before any public release. Attribution is preserved in `manifest.csv`.

## Clearest do / don't pairs

| Do                                   | Don't                                  | Teaches                                                |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------ |
| `clarity_form_error_do.svg`          | `clarity_form_error_dont.svg`          | error indicator placement; pair color with icon + text |
| `clarity_form_label_grouping_do.svg` | `clarity_form_label_grouping_dont.svg` | labels close to controls; group related inputs         |
| `ant_button_primary_do.png`          | —                                      | one primary button per group                           |
| `clarity_modal_dismiss.png`          | `clarity_modal_stacking.png`           | intentional dismissal; never stack modals              |

## Synthesis diagrams

- `generated_concept_principles.png` — the five universal business-app principles.
- `generated_ai_business_app_rules.png` — applying the rules to AI/productivity surfaces.

## "What good looks like" — pattern examples by area

| Area               | Images                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Layout             | `ant_layout_left_right` · `ant_layout_proximity_spacing`                                                          |
| Navigation         | `ant_navigation_side` · `ant_navigation_top` · `ant_tabs_basic` · `ant_steps_horizontal` · `ant_pagination_basic` |
| Feedback           | `ant_feedback_alert` · `ant_feedback_loading` · `ant_feedback_progress` · `ant_feedback_input_error`              |
| Forms / data entry | `ant_data_entry_input` · `_hint` · `_search` · `_radio` · `_switch`                                               |
| Data display       | `ant_data_display_table` · `_collapse` · `_card_grid`                                                             |
| Data lists         | `ant_data_list_table` · `ant_data_list_filter`                                                                    |
| Actions / buttons  | `ant_button_types` · `_danger` · `_placement` · `_footer` · `_label_modal`                                        |
| Copywriting        | `ant_copywriting_concise`                                                                                         |

The rules these illustrate (R001–R103) are summarized in `../../reference/principles.md`;
full source URLs + download status are in `manifest.csv`.
