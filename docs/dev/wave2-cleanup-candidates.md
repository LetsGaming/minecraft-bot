# Wave 2 cleanup candidates

Paths in the repo that exist only as Wave 2 (and Wave 1) working material. Nothing
here has been deleted; the owner confirms the list first. For each path: what is
in it, whether anything durable lives only there, and every reference to it from
outside `docs/dev/refactor/`.

Checked with `git grep` over the whole tree (source, scripts, tests, workflows,
`CLAUDE.md`, `README.md`, `CHANGELOG.md`, docs) for `refactor/`, the file names
below, `mockup`, `hybrid`, `DASH-` and `DISC-`. `scripts/check-layout.mjs` only
checks `src/` and does not mention `docs/`; no test, script, workflow or source
comment points into `docs/dev/refactor/`.

## Wave 2 material

| Path | Contents | Durable content only here? | References from outside |
|---|---|---|---|
| `docs/dev/refactor/wave2-ux-audit.md` | The UX synthesis: findings by theme, shared vocabulary, open questions Q1 to Q12 | No. The answered questions are in [decisions.md](decisions.md) (Hybrid, English-only dashboard with `t()`, dark only), the vocabulary is in `src/schema/glossary.ts` and [bot/replies.md](bot/replies.md#language), the finding ids are in [wave2-summary.md](wave2-summary.md) | None |
| `docs/dev/refactor/wave2-audit/dashboard.md` | Dashboard audit appendix, findings DASH-01 to DASH-25 | No. Every id with a one-line description and its status is in [wave2-summary.md](wave2-summary.md) | [wave2-summary.md](wave2-summary.md) names the folder in its intro (one sentence to drop) |
| `docs/dev/refactor/wave2-audit/discord.md` | Discord audit appendix, findings DISC-01 to DISC-36, command inventory, German review | No. Ids are in [wave2-summary.md](wave2-summary.md); the German terminology map was moved to [bot/replies.md](bot/replies.md#language) in P7 | As above |
| `docs/dev/refactor/wave2-audit/shots/` | 24 screenshots of the dashboard before Wave 2 (1.9 MB) | No | None |
| `docs/dev/refactor/wave2-audit/after/` | Screenshots per phase: `p0b`, `p1`, `p2`, `p3`, `p4`, `p6a`, `p6b-admin`, `p6b-monitor` (about 8.6 MB), plus whatever the P7 browser pass adds | No | None in this branch. The parallel P7 browser branch writes into it; check its references before deleting |
| `docs/dev/refactor/wave2-p3-primevue-spike.md` | P3 spike: which PrimeVue parts fit the Hybrid contract | No. The verdicts (no `DataTable` for new tables, `StatusChip` instead of `Tag`, `ConfirmDialog` kept) are in [decisions.md](decisions.md#wave-2-primevue-stays-the-base-datatable-is-not-used-for-new-tables) | None |
| `docs/dev/refactor/mockups/README.md` | Index of the four directions | No | None |
| `docs/dev/refactor/mockups/hybrid/` | The chosen direction: `direction.md` (contract, decision table, design system, phase plan, effort, checked backend assumptions), HTML pages, `tokens.css`, `style.css`, `app.js`, `img/`, `shots/` (1.8 MB) | No. The decision table is in [decisions.md](decisions.md); token values and component rules are in the code and [web/frontend.md](web/frontend.md); the Discord rules of `discord.html` are in [bot/replies.md](bot/replies.md) and the snapshots; the phase plan and what was deferred are in [wave2-summary.md](wave2-summary.md); the restore and backup facts are in [admin/dashboard.md](../admin/dashboard.md#backups) | None outside the folder. `tests/bot/discordSnapshots/` was compared with `discord.html` once in P7 but does not reference it |
| `docs/dev/refactor/mockups/polish/` | Rejected direction (pages, tokens, `shots/`) | No | None |
| `docs/dev/refactor/mockups/evolve/` | Rejected direction (pages, tokens, `fonts/` with IBM Plex and its OFL licence, `shots/`) | No | None |
| `docs/dev/refactor/mockups/identity/` | Rejected direction (pages, tokens, `shots/`) | No | None |

## Wave 1 material (only if the owner agrees)

| Path | Contents | Durable content only here? | References from outside |
|---|---|---|---|
| `docs/dev/refactor/wave1-summary.md` | Wave 1 outcome: per phase, deferred items, verification, cross-repo merge order | **Yes.** It is the only record of Wave 1. Move it to `docs/dev/wave1-summary.md` instead of deleting it, and fix its link to `wave1-audit.md` | [docs/readme.md](../readme.md) (developer table), [dev/readme.md](readme.md) ("Refactor records") |
| `docs/dev/refactor/wave1-audit.md` | Wave 1 audit, findings F01 to F73 | Partly: the finding descriptions behind the ids that `wave1-summary.md` cites. Keep it next to the moved summary, or accept that the ids lose their detail | `docs/dev/refactor/wave1-summary.md` only |

## Links to fix when the folder goes

- [docs/readme.md](../readme.md): the "Wave 1 refactor: audit and summary" row.
- [dev/readme.md](readme.md): the "Refactor records" section (both paragraphs).
- [wave2-summary.md](wave2-summary.md): the sentence pointing at `docs/dev/refactor/wave2-audit/`.
- This file.

`CLAUDE.md` does not reference the folder.

## Outside the repo tree

Not repo paths, listed so they are not forgotten: the worktrees under
`../_wt/` and the local and remote `refactor/w2c-*` and `refactor/w2-b-*`
branches. They also need the owner's confirmation before removal.
