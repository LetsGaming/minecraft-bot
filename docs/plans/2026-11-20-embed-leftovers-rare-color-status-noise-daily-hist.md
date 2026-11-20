---
approved: 2026-11-20T12:48:28.716Z
session: 5d1018cc-614e-47ea-9ed1-8a03cd257d51
status: active
---

<!-- Written by the save-plan hook. Record deviations below the plan. -->
# Embed leftovers: rare color, /status noise, /daily-history roles

## Context

The last critique of the Discord embeds scored 27/40 and left three items undone:

1. The rare tier color `#60a5fa` is too close to the info and server blue `#7cb4ff` (CIE76 deltaE 8.4). Every other default is at least 14 away.
2. `/status` has two noisy things: "Bot Ping" and "Round Trip" fields on every state (and "Round Trip: 0ms" looks like a bug), and an online server with a down wrapper shows a green circle, the title "Online" and an amber bar, with the explanation only in the description.
3. `/daily-history` joins all items of a claim into one comma list, so it never shows which was the main reward, the lucky bonus or the milestone.

This is a different task from the previous plan (the wide reward pool, done and deployed), so this file replaces it.

## Owner decisions

- Latency: one "Response time" field, shown only when the server is online and the wrapper answers.
- Wrapper down: the title names it ("Online, wrapper unreachable"); the green circle and the amber bar stay.
- History: the main reward on the first line, the extras under it.

## Findings

- "Bot Ping" is the Discord gateway latency (`interaction.client.ws.ping`). "Round Trip" is the time the bot spent reading the server health (`Date.now() - sent` after `getHealth()` in `src/bot/commands/info/status.ts:98-103`), not a Discord round trip. Only `status.ts` uses the keys `status.botPing` and `status.roundTrip`.
- `describeHealth` (`src/bot/utils/embeds/serverStateDisplay.ts`) feeds `/status` and the auto-updating status embed (`logWatcher/watchers/schedulers/statusEmbed.ts:232`). `/uptime` uses `describeState`, which does not change. The design note in that file ("a server that is demonstrably fine keeps its own circle and label and is coloured amber") stays true; only the label gains the second fact.
- A claim's stored `items` are `[main, lucky?, ...milestone]`. `stack()` in `rewardRoll.ts` keeps `tier` on the main and lucky stacks, and milestone items have none. So: the first item is the main one when it has a tier, a second tiered item is the lucky bonus, the rest are milestone items. Entries from before tiers (or from an untiered pool) have no tier on the first item and keep the plain list. No change to the stored data.
- `find-colors.mjs` (scratchpad search, deltaE at least 18 from every other key, contrast at least 1.5 on both themes) gives `#3d9afe` for rare (contrast 4.76 on dark, 2.61 on light).

## Steps

1. **Rare color.** `src/schema/embedCategories.ts`: `rare` becomes `0x3d9afe`. Extend `tests/schema/embedCategories.test.ts` with a CIE76 check: no rarity color is closer than 12 to any category or status color (the existing test only forbids an identical hex).
2. **Latency field.** In `status.ts`, remove the two fields from the short branch (`!canQueryServer`) and replace the two fields of the full branch with one inline "Response time" field. Locale keys: drop `status.botPing` and `status.roundTrip`; add `status.latency` ("Response time" / "Antwortzeit") and `status.latencyValue` ("Discord {bot} ms · server check {query} ms" / "Discord {bot} ms · Serverabfrage {query} ms"), en and de.
3. **Wrapper-down title.** In `describeHealth`, when the wrapper is down and the state is Online, set `label` to a new key `state.onlineWrapperDown` ("Online, wrapper unreachable" / "Online, Wrapper nicht erreichbar"). Other states keep their label. The hint, color and severity stay as they are. The auto-updating status embed picks it up through the same function.
4. **History roles.** A new `historyLines(items)` in `src/bot/utils/embeds/itemBlocks.ts` (the one file that formats items) returns the lines of one claim: the first line is the main reward with its tier icon, and an optional second line starts with `↳` and lists `🍀 <tier icon> <lucky>` and `🎉 <milestone item>` entries separated by " · ". When the first item has no tier it returns the plain list on one line. `dailyHistory.ts` builds each claim as `dailyHistory.line` (date, streak day, main reward) plus the extras line. No `-#` or `##` marker is used here, because their rendering is not verified.
5. **Fit the limit.** The longest claim is main, lucky and three milestone items. A test builds 15 such claims and asserts the description stays under 4096 characters in English and German; if it does not, lower `MAX_SHOWN`.
6. **Tests.** Unit tests for `historyLines` (full claim, lucky only, milestone only, untiered fallback); the status tests and the `status.json` snapshot fixture (regenerate with `node scripts/discord-snapshots.mjs --update` and read the output, do not just accept it); the history command test if one exists.
7. **Docs and changelog.** `docs/dev/bot/replies.md` (status latency rule, wrapper-down title, history layout, the rare color and the deltaE rule), `docs/dev/bot/embed-audit.md` if it lists these as open, and `CHANGELOG.md` under `[Unreleased]`.
8. **Checks, once:** `npm run typecheck`, `lint`, `i18n:check`, `schema:check`, `layout:check`, `npm test`, and an em dash scan of the added lines. Then one local commit on `main` (conventional, no scope).

## Verification

- The snapshot output for `/status`: offline, unresponsive, unknown and wrapper-down replies have no latency fields; the online reply has one "Response time" field; the wrapper-down title reads "Online, wrapper unreachable" and keeps the amber bar.
- A history reply for a claim with main, lucky and milestone items shows two lines; an old untiered claim shows one.
- The palette tests pass with the new rare color.
- Full suite green.

## Not in scope

- No push, tag or deploy. The owner asked for the leftovers to be done, not shipped; the last deploy is `cb11d3c` and this lands as a local commit on top of it.
- No stored-data change for history, and no change to the other states' labels.

## Risks

- The label change touches the auto-updating status embed too; its snapshot may need the same regeneration.
- The latency fields disappear from offline replies. That is the intent, but anyone who used "Bot Ping" from an offline `/status` loses it.
