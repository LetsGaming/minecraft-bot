---
approved: 2026-11-21T17:48:00.707Z
session: 5d1018cc-614e-47ea-9ed1-8a03cd257d51
status: active
---

<!-- Written by the save-plan hook. Record deviations below the plan. -->
# Player heads: key the image by the skin itself

## Context

Version 8.6.1 made heads consistent and refreshable, but some players still show the wrong head. The owner reports `Wolfbeastmaster` gets the default Steve head. 8.6.1 could not fix this, because the cause is not Discord's cache.

## Findings (measured today, with read-only requests)

- `Wolfbeastmaster` is a real Mojang account (UUID `94a654f9...`) with a custom blue skin and a cape. mc-heads returns its default head for that name, for the UUID (dashed and dashless), for every image size, and for `/head/`. The bytes equal the head mc-heads returns for a name that cannot exist. Minotar, Mineatar and every other casing of the name return the real blue head.
- A second player is wrong the other way. For `Micha_Falke`, mc-heads returns an OLD skin (a green head) under the exact spelling `Micha_Falke`, and the current white head under `micha_falke`. Minotar agrees with the lowercase one. So mc-heads keeps stale data per exact key: a cached default head for one player, an outdated skin for another. This could not be seen from our side before.
- Of the 21 players the bot knows, 2 differ between proper case and lowercase. Lowercasing names would change `Micha_Falke` to the current skin but is a trick on an mc-heads quirk, so it is not the fix.
- mc-heads accepts Mojang's texture hash as the key: `avatar/<hash>/64` returns the real head for both players (checked against Minotar and the skin file). The hash is in Mojang's own profile (`sessionserver.mojang.com/session/minecraft/profile/<uuid>`, property `textures`, the last path part of the SKIN url). A hash names the exact skin image, so a hash URL cannot be stale: when the player changes skin, the hash and so the URL change.
- Earlier finding stays true: a `?v=` on the URL fixes only Discord's cache, never mc-heads' own. That is why 8.6.1 was "definitely better" but not the cure.
- Mojang calls already exist: `fetchMojangProfile` (`src/core/utils/minecraft/mojang.ts`) maps a name to a UUID through `fetchJson`. Schedulers live in `src/bot/logWatcher/watchers/schedulers/` and start in `initMinecraftCommands.ts`. The join handler is `joinLeave.ts` (`notify` builds the join embed).

## Approach

Resolve each player's current skin hash from Mojang in the background, store it, and build head URLs from the hash. The URL builder stays one synchronous function, so every caller (embeds, bridge avatars, leaderboard, dashboard) changes at once. A player whose skin cannot be resolved keeps today's name URL.

## Steps

0. **Cleanup the owner asked for.** Delete the `.playwright-mcp/` folder in the repo root (the owner approved this deletion) and remove the `.playwright-mcp/` line I added to `.git/info/exclude`.
1. **Mojang skin lookup.** In `mojang.ts`: `parseSkinHash(raw)` (pure: decodes the base64 `textures` property, returns the hash, `"default"` when the profile has no SKIN texture, or `null` when the body is misshapen) and `fetchSkinHash(uuid)` through `fetchJson`, returning `{ kind: "skin", hash } | { kind: "default" } | { kind: "unavailable" }`. A 429 or a network failure is `unavailable`, never `default`.
2. **Store.** Extend `headStore.ts` with `skin?: { hash: string | null; checkedAt: number }` per lowercase name (`null` = default skin or unknown). Functions: `getSkin`, `setSkin`, `pruneSkins(keep)`. The `__proto__` safe map and the malformed-entry handling stay.
3. **URL builder.** `playerHeadUrl` in `playerHead.ts` uses `/avatar/<hash>/64` when a hash is stored, else `/avatar/<name>/64`; both keep `?v=<day>[.<bump>]`. `probeHead` and the dashboard head route already call the builder, so they follow.
4. **Resolver.** New `src/core/utils/minecraft/skinResolver.ts`:
   - `resolveSkin(name, { force })` does name to UUID (`fetchMojangProfile`), UUID to hash (`fetchSkinHash`), then verifies a NEW hash once by fetching mc-heads under it and comparing with mc-heads' default head (fetched once per process from an impossible name). If mc-heads answers the default for a hash, it stores nothing, keeps the name URL and logs one warning ("mc-heads no longer accepts texture hashes"). This keeps the feature safe if mc-heads changes.
   - `ensureFreshSkin(name, { maxAgeMs, timeoutMs })` resolves only when the stored check is older than `maxAgeMs`, and gives up after `timeoutMs` (so a slow Mojang never delays a message). A failed lookup keeps the old hash and retries after 6 hours.
   - Mojang limits apply (the profile call allows about one request a minute per UUID; names 600 per 10 minutes), so lookups run one at a time with 1.5 s between them, and a 429 stops the sweep.
5. **Bot wiring.** New `skinScheduler.ts`, started in `initMinecraftCommands.ts` next to the other schedulers: 30 seconds after start and then every 30 minutes, it refreshes the players seen in the last 60 days plus linked accounts (a small new query `recentPlayerNames` in `sessionStore.ts`), each at most once an hour, and prunes entries for players no longer in that set. In `joinLeave.ts`, `notify` awaits `ensureFreshSkin(player, { maxAgeMs: 10 min, timeoutMs: 3 s })` for a join before queueing the embed, so a skin changed minutes ago shows on the join message. The first sweep after deploy fixes `Wolfbeastmaster` and `Micha_Falke` within a minute.
6. **`/skin` and the dashboard.** `/skin refresh` and the dashboard Refresh button call `resolveSkin(name, { force: true })` before the bump, and say what happened ("skin changed", "unchanged, still current", "Mojang did not answer"). `/skin show` and the head info route add how the head is keyed (skin hash or name) and when Mojang was last asked. New locale strings in en and de and the frontend en file; `PlayerHeadInfo` gains `keyedBy` and `skinCheckedAt`.
7. **Tests.** `parseSkinHash` (skin, no skin, cape only, bad base64, missing property); the resolver with `fetch` stubbed (changed hash, unchanged, default skin, 404 name, 429 keeps the old hash and stops, network failure, a hash that mc-heads answers with the default is not stored); `ensureFreshSkin` age and timeout rules; URL builder with and without a hash; scheduler selection and spacing with fake timers; the join path (resolver awaited, 3 s cap, no stall); updated `/skin` and route tests. Snapshot fixtures should not change (no stored hash in tests).
8. **Docs and changelog.** `docs/dev/bot/replies.md` (replace the "version cannot clear mc-heads" paragraph with the hash approach), `docs/user/commands.md`, `docs/admin/setup.md` (the bot now asks Mojang for the skin of each known player about hourly, in addition to the whitelist lookup it already does; player names go to Mojang and mc-heads), `CHANGELOG.md` under `[Unreleased]` (Fixed: heads show the current skin; the old default and outdated heads).
9. **Checks, once:** typecheck, lint, i18n:check, schema:check, layout:check, the full tests, the em dash scan. One local commit on `main`.

## Verification

- Unit and route tests above, then the full suite green.
- Isolated `dev-up.mjs --id skin-hash --only web` session: seed a session row for `Wolfbeastmaster`, call the refresh route, and confirm the head URL now uses the hash and the image is the blue head (compare the bytes with the ones fetched today: `7b156f93` by hash, `831a8195` is the wrong default). Repeat for `Micha_Falke` (current head `d45342d0`, old head `f655ee93`). Slash commands cannot run in a dev session, so `/skin` stays covered by tests.
- After the owner deploys: `/skin show` for `Wolfbeastmaster` reports keyed by skin hash; a new `/daily` shows the blue head.

## Not in scope

- No push, release or deploy until the owner asks. No self-hosted heads, no provider switch. The hash approach stays on mc-heads, with the name URL as the fallback.

## Risks

- mc-heads' acceptance of hashes is observed, not documented. The verification in step 4 detects a change and falls back to names, so the worst case is today's behaviour.
- Mojang rate limits. Volume is about 2 requests per player per hour (about 40 an hour for 21 players), far below the limits, and a 429 stops the sweep.
- The skin check adds a small outgoing request pattern (player names to Mojang). Names already go to Mojang for whitelist checks and to mc-heads for heads, and step 8 documents it.
- A skin change shows after the next check: on the player's next join, on a manual refresh, or within about an hour from the sweep.

## Deviation log

- Step 1: the Mojang functions are `lookupMojangProfile`, `parseSkinTexture` and `lookupMojangSkin`, returning a typed `MojangLookup` (found, unknown, unavailable with a rateLimited flag) instead of the planned `parseSkinHash` and `fetchSkinHash`. Reason: the sweep has to tell a rate limit from a missing account, which the old `fetchMojangProfile` (null for both) cannot do.
- Step 2: a skin entry also holds `failedAt`, so a failing lookup is not retried for 6 hours while the old hash stays in use.
- Step 5: `joinLeave.ts` calls a new synchronous `skinIsFresh` first and only waits when a check is due. Reason: almost every join has a recent check, and those joins must not be delayed even by an async step (it also kept the existing watcher tests deterministic).
- Step 6: `PlayersView.vue` says nothing about the key when the backend does not send it. Reason: during a rollout the new page can meet an older backend, and a component test showed the render broke on the missing field.
- Verification: the dev session ran against the real Mojang and mc-heads. `Wolfbeastmaster` went from the default head (md5 831a8195) to the blue one (7b156f93) and `Micha_Falke` from the old green skin (f655ee93) to the current one (d45342d0), as predicted.
