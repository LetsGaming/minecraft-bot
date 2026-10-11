# Wave 2 P3: PrimeVue spike

Question: can PrimeVue 4.5.5 (the version in `src/web/package.json`) render the Hybrid contract for the base components (shaped status chips, a table that becomes cards on phones, a typed confirm) or do some of them need plain markup? Checked by mounting the components in jsdom (`@vue/test-utils`) and by reading the 4.5.5 sources in `src/web/node_modules/primevue`.

## Outcome

| Piece | PrimeVue part | Verdict | Why |
|---|---|---|---|
| Status chip shapes | `Tag` | Not used. `StatusChip` is one `span` with a CSS shape | `Tag` colours come from its severities (success, warn, danger), which are not the seven status roles. The shapes (circle, diamond, ring, dash, dashed ring, check, spinner) are a few lines of CSS on a child `span`, so a wrapper buys nothing. |
| Table with sticky header, card layout under 760 px, per-row busy | `DataTable` | Not used. `ResponsiveTable` is a native `table` | 4.5.5 has no stack layout: `responsiveLayout` is gone and the `breakpoint` prop is still declared but no code reads it. Cards would mean restyling DataTable's internal cells through `pt` on every column. Its paginator counts pages, while the backup list pages forward with a cursor ("Load more"). A native table keeps the caption, header cells and row semantics, and a container query turns rows into cards. |
| Typed confirm, focus | `ConfirmDialog` with the `container` slot | Used, and extended | An element with `autofocus` inside the container slot gets focus after the dialog opens, and focus returns to the element that opened it when it closes (both checked in jsdom). So the existing global host (`TypedConfirmDialog`, group `typed-name`, mounted once in the shell) can carry all three confirm levels. No second dialog host and no shell change are needed. |
| Filter | `Select` with an option slot | Usable, not used on Backups | The option slot renders any markup, chips included. The Backups type filter stays a row of toggle buttons with counts, as in the mockup, because it wraps on a phone and shows every count at once. `Select` stays the choice for long option lists. |
| Buttons, toasts | `Button`, `Toast` | Used unchanged | The preset already maps them onto the role tokens (P1). |

## Contract changes that follow

- `ResponsiveTable` takes `columns` and `rows` and renders cells through named slots (`cell-<key>`, `actions`). Below 760 px of its own width (container query, not viewport) each row is a card: the `primary` column is the card title, other cells show their column label, actions take a full-width row. Rows report busy through `aria-busy` and a class.
- `useConfirmAction` extends `useTypedConfirm` on the same host. Levels: `inform` (one button), `disruptive` (Cancel plus the action, Cancel focused), `irreversible` (typed text, the input focused). A `blocked` reason turns any level into a dialog whose action is off and that can offer one alternative (for Backups: open Servers).
- `StatusChip` replaces the internals of `StatusDot` and `ConfigStatusChip`; both keep their props, so their call sites (several in the shell) did not have to change in this phase.

## Not checked here

Real phones, screen readers and pixel parity with the mockups. The mockups are the contract for tokens, states and copy, not for exact spacing.
