# Wave 2 design directions: side by side

Three directions for the dashboard and the Discord experience, each built as static HTML mockups against the same requirements (`../wave2-ux-audit.md`, section 8). Open `<direction>/preview.html` to see every screen at desktop (1440) and mobile (390) width, with a state picker per screen. Each direction has a `direction.md` with its contract, design system, implementation impact and an honest review.

| | 1. Polish | 2. Evolve | 3. New identity |
|---|---|---|---|
| One line | The same app, but correct | One visual language, built from the Mods tab's qualities | A status-first control room, one palette across dashboard and Discord |
| Open | [polish/preview.html](polish/preview.html) | [evolve/preview.html](evolve/preview.html) | [identity/preview.html](identity/preview.html) |
| Recognisable to current admins | Yes, almost unchanged | Yes, same structure and views | No: new home, 9 nav items in 3 groups instead of 11 |
| Distinctive axes (operate mode, max two) | Precision of states, density | Status system with state-driven motion, IBM Plex type scale | Status-first layout ("Needs you" queue), restrained state-only colour |
| Themes | Dark | Dark and light, comfortable and compact density | Dark and light |
| Effort (person-days) | 35.5 to 51 (plan 38 to 48), plus about 3 for the audit hotfixes | 35 to 55 (most likely about 44) | 38 to 54 |
| Phases for Phase C | 6 (tokens, base components, config editing, Discord builders, remaining screens) | 6 | 6 (C1 tokens and base components first) |
| New dependencies | None stated | None (IBM Plex shipped as local woff2, OFL) | None stated |
| Backend work needed | Pre-restore safety copy, job steps and a "reloaded" signal are proposals to confirm with the wrapper | Wrapper job step reporting is assumed | New read model for the "Needs you" queue; Undo lines (pre-restore snapshot, `.disabled` jars) depend on wrapper behaviour |
| Biggest risk | Tokens and PrimeVue preset touch every view; the 1,574-line Mods rewrite could regress the best flow | Half-migrated views while moving to tokens; PrimeVue may not reproduce the chip shapes and edge motion | Every admin's mental model changes; a half-built queue is worse than a plain Overview |
| Cut order if time is short | Not stated in its document | Not stated in its document | Stated: classic-layout toggle, Mod Config as a tab, change-history merge, jobs tray and queue, light theme |
| What it keeps wrong | Generic admin look, dark only, no brand voice, long Config page | Standard admin shell, modest identity | Text-only rail (no distinct icons), quiet dirty-field marker, lamp emoji vary by platform |
| Discord | Light-touch unification of the existing embeds | One status colour map shared 1:1 with the dashboard, title, footer and emoji rules | Shared palette and an Affects / Takes effect / Undo ledger in dialogs and Discord confirmations |

## What all three fix

The audit's must-haves are in every direction: contrast and visible focus (tokens), responsive navigation that works at 360, 44px touch targets, labels bound to inputs, one confirm pattern, one feedback pattern, full state coverage on the config editor, Mods tab with the update availability check, and Backups, the unsaved-edit guard, deep-linkable views, and a Discord error format that names the problem and the recovery. German copy is natural du-form in all three.

## How the three were checked

Rendered in Microsoft Edge at 1440, 390 and 360 (Evolve was checked at 430 for overflow and touch targets only, not visually), one fix round each, axe-core 4.10.2 with no remaining violations on the pages and states tested (Identity: one light-theme chip contrast fix not re-run through axe). No horizontal overflow at any tested width.

## What none of the checks could show

- A real phone, a screen reader, a full keyboard walk.
- Live Discord rendering: the message panes are approximations of Discord's dark theme.
- PrimeVue fidelity: the mockups are plain HTML and CSS, so real spacing and component details will differ after the build.
- German copy has not been read by a native speaker.
- Effort numbers are estimates from call-site counts on the current branch.

## Independent of the choice

The audit's hotfix list does not depend on any visual direction and does not need to wait: German whitelist modal label too long (DISC-01), public `/config show` output (DISC-05), the shared relative-time helper that treats UTC stamps as local time (DASH-08), unsaved edits discarded silently (DASH-03, DASH-04), `/daily` replying after saving (DISC-02), the dispatcher's hard-coded English error (DISC-03), and the contrast and focus token fix (DASH-05, DASH-06).
