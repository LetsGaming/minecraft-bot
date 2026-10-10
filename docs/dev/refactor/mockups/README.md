# Wave 2 design directions: side by side

Four directions for the dashboard and the Discord experience, each built as static HTML mockups against the same requirements (`../wave2-ux-audit.md`, section 8). Open `<direction>/preview.html` to see every screen at desktop (1440) and mobile (390) width, with a state picker per screen. Each direction has a `direction.md` with its contract, design system, implementation impact and an honest review.

| | 1. Polish | 2. Evolve | 3. New identity | 4. Hybrid |
|---|---|---|---|---|
| One line | The same app, but correct | One visual language, built from the Mods tab's qualities | A status-first control room, one palette across dashboard and Discord | Today's look on Evolve's token roles, status shapes and components |
| Open | [polish/preview.html](polish/preview.html) | [evolve/preview.html](evolve/preview.html) | [identity/preview.html](identity/preview.html) | [hybrid/preview.html](hybrid/preview.html) |
| Recognisable to current admins | Yes, almost unchanged | Yes, same structure and views | No: new home, 9 nav items in 3 groups instead of 11 | Yes, same charcoal, green and system fonts, same views. Backups is Polish's own layout in Hybrid's tokens, Mods keeps its icons and Modrinth catalog |
| Distinctive axes (operate mode, max two) | Precision of states, density | Status system with state-driven motion, IBM Plex type scale | Status-first layout ("Needs you" queue), restrained state-only colour | Shaped status system shared with Discord, density |
| Themes | Dark | Dark and light, comfortable and compact density | Dark and light | Dark; light is an optional late phase (3 to 4 days) |
| Effort (person-days) | 35.5 to 51 (plan 38 to 48), plus about 3 for the audit hotfixes | 35 to 55 (most likely about 44) | 38 to 54 | 41.5 to 57 (most likely 49), hotfixes included |
| Phases for Phase C | 6 (tokens, base components, config editing, Discord builders, remaining screens) | 6 | 6 (C1 tokens and base components first) | 8 (P0 to P7, each ends shippable), plus optional light theme |
| New dependencies | None stated | None (IBM Plex shipped as local woff2, OFL) | None stated | `vue-router` only |
| Backend work needed | Pre-restore safety copy, job steps and a "reloaded" signal are proposals to confirm with the wrapper | Wrapper job step reporting is assumed | New read model for the "Needs you" queue; Undo lines (pre-restore snapshot, `.disabled` jars) depend on wrapper behaviour | Fewer assumptions: apply states, update check and restore flow checked against existing code. New and small: `iconUrl` on installed mods (about 1 day, installed rows and check rows). Still unverified: free-space figure, dashboard bot-restart control, per-field `effect` metadata |
| Biggest risk | Tokens and PrimeVue preset touch every view; the 1,574-line Mods rewrite could regress the best flow | Half-migrated views while moving to tokens; PrimeVue may not reproduce the chip shapes and edge motion | Every admin's mental model changes; a half-built queue is worse than a plain Overview | Inheriting both parents' weaknesses: generic look and a wide migration; Backups copy must track the restore script; installed-row mod icons need data the API does not return yet |
| Cut order if time is short | Not stated in its document | Not stated in its document | Stated: classic-layout toggle, Mod Config as a tab, change-history merge, jobs tray and queue, light theme | Stop point stated after every phase; light theme is the optional last phase |
| What it keeps wrong | Generic admin look, dark only, no brand voice, long Config page | Standard admin shell, modest identity | Text-only rail (no distinct icons), quiet dirty-field marker, lamp emoji vary by platform | Generic admin look, no Plex type, no light theme until the optional phase, no state-edge animation |
| Discord | Light-touch unification of the existing embeds | One status colour map shared 1:1 with the dashboard, title, footer and emoji rules | Shared palette and an Affects / Takes effect / Undo ledger in dialogs and Discord confirmations | Evolve's shared status colour map and rules on today's hues, no separate celebration colour |

## What all four fix

The audit's must-haves are in every direction: contrast and visible focus (tokens), responsive navigation that works at 360, 44px touch targets, labels bound to inputs, one confirm pattern, one feedback pattern, full state coverage on the config editor, Mods tab with the update availability check, and Backups, the unsaved-edit guard, deep-linkable views, and a Discord error format that names the problem and the recovery. German copy is natural du-form in all four.

## How the four were checked

Rendered in Microsoft Edge at 1440, 390 and 360 (Evolve was checked at 430 for overflow and touch targets only, not visually), one fix round each, axe-core 4.10.2 with no remaining violations on the pages and states tested (Identity: one light-theme chip contrast fix not re-run through axe). No horizontal overflow at any tested width. Hybrid: all states of Config, Mods and Backups at 1440, 390 and 360, axe-core 4.10.2 clean on the pages and states listed in its `direction.md` (390 and 360 were checked for overflow and 44 px targets, 430 was not looked at). After the owner review (wider content area, mod icons, Polish's Backups view) Hybrid was checked again at 1440, 1920, 2560, 390 and 360 with one fix round and a confirm round.

## What none of the checks could show

- A real phone, a screen reader, a full keyboard walk.
- Live Discord rendering: the message panes are approximations of Discord's dark theme.
- PrimeVue fidelity: the mockups are plain HTML and CSS, so real spacing and component details will differ after the build.
- German copy has not been read by a native speaker.
- Effort numbers are estimates from call-site counts on the current branch.

## Independent of the choice

The audit's hotfix list does not depend on any visual direction and does not need to wait: German whitelist modal label too long (DISC-01), public `/config show` output (DISC-05), the shared relative-time helper that treats UTC stamps as local time (DASH-08), unsaved edits discarded silently (DASH-03, DASH-04), `/daily` replying after saving (DISC-02), the dispatcher's hard-coded English error (DISC-03), and the contrast and focus token fix (DASH-05, DASH-06).

## Assumptions that did not survive checking against the code

Found while building the Hybrid direction (details and file references in `hybrid/direction.md`, section "Backend assumptions, checked"). They affect the other directions' mockups:

- **Restore has no steps and no safety copy.** The wrapper's restore is one blocking call (10 minute timeout) that refuses to run while the server is online and does not stop it; it takes no snapshot first. A step-by-step restore job block and an "Undo: pre-restore snapshot" line, as the Evolve and New identity mockups imply and the Polish `direction.md` lists as a proposal, need new wrapper behaviour or must be dropped.
- **Update-check progress is per mod, not per step.** The existing `ModCompatJob` reports `state`, `progress {done,total}`, partial results, a summary and an error text. Per-mod step detail, a log, an ETA or Cancel are not available.
- **Evolve's `backup:write` capability does not exist.** The real ones are `backup:create`, `backup:restore` and `backup:delete`.
- **Still unverified proposals** in several directions: a free-space figure for restore, a bot restart control in the dashboard, per-field `effect` and `reload` metadata in the schema.

Every direction's cost estimate should be read with this in mind: if a direction's headline feature depends on a wrapper change, that change is extra work in the wrapper repo.
