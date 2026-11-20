# Embed critique fixes, in order, then a new critique

Source: the critique of all Discord embeds (score 25/40) and the confirmed brief for the shared item block. The owner asked to run the remaining items in order without stopping, then to critique again.

## Done before this plan

- Shared item block (hero line, tier line, stack hint, bullets) in claimed, lucky, milestone, queued, `/streak` and `/daily-history`. Local commit `7417d33`.

## Steps

1. **clarify**: queued and cooldown copy. Cooldown title that does not scold, "5-day streak" grammar, one sentence in the lucky footer, no duplicate lucky text.
2. **item names (adapt)**: game-accurate English names from the vendored catalog with overrides for music discs and armor trims; a German name map for the pool's item ids with English fallback.
3. **colorize**: the side bar always shows the tier; milestone and lucky are blocks, not bar colors; separate the three colliding hues (legendary, advancement and degraded; uncommon and success; common and unknown); fix the milestone gold on the light theme.
4. **audit** (every embed): `replies.md` against the real colors, the mods link wall, repeated player names in join, leave, death and advancement embeds, English game text in German embeds (decide), footer rule.
5. **polish**: final pass, snapshot fixtures, docs, changelog.
6. **critique**: a fresh critique of all embeds, with the score against 25/40.

## Defaults chosen while running unattended

- German item names are drafted by the agent and are not reviewed by the owner. They ship in the repo only (local commits, no push, no deploy), so the owner can review them before anything reaches prod.
- No push, tag or deploy: the owner asked for the fixes and the critique, not a release.
- Game text that comes from the server log (death messages, advancement titles) stays as the server wrote it unless a name table already exists for it.

## Acceptance

- Typecheck, lint, `i18n:check`, `schema:check`, `layout:check` and the full test suite pass after each step that changes code.
- Snapshot fixtures are regenerated and read, not only accepted.
- No em dashes in anything added.
- The new critique runs the same two isolated assessments and states the score change.
