---
approved: 2026-11-20T22:36:22.190Z
session: 5d1018cc-614e-47ea-9ed1-8a03cd257d51
status: active
---

<!-- Written by the save-plan hook. Record deviations below the plan. -->
# Player heads: same image everywhere, self-healing, refreshable

## Context

The owner sees their correct skin on bridge messages, but the default Steve/Alex head on their `/daily` reply. There is no way to see, clear or fix the head the bot uses.

## Findings

- The bot keeps no skin cache. Every head is `https://mc-heads.net/avatar/<name>/64`, built by `playerAvatarUrl` in `src/bot/utils/mcHeads.ts`. Users: the bridge webhook avatar (`chatBridge.ts:402,580`), `createPlayerEmbed` (`embedUtils.ts:189`, which covers `/daily`, `/streak`, events and the other player embeds), and the leaderboard thumbnail (`statEmbeds.ts:37`). The dashboard proxies the same URL in `src/web/backend/routes/players.ts:159`, with a 1 h browser cache.
- The two caches that matter are external. mc-heads.net caches skin lookups. Discord's image proxy caches each image it fetched. When mc-heads answers once with the default head (for example during a Mojang lookup failure), that image can stick for one place and not another. The bot can neither see nor clear that.
- The owner's stored link name on prod (`LetsGamingDE420`) is valid and current, so a stale link name is not the cause. All 9 stored names on prod are valid.
- `kvGet`/`kvUpdate` in `src/core/db/kv.ts` are synchronous and shared by the bot and the dashboard through `data/bot.db`, so a version written by one process is read by the other on the next call.

## Owner decisions

- The head URL carries a version that changes once a day, so a bad cached image heals by itself within a day. Admins can also force a refresh for one player at once.
- No manual override and no self-hosted heads.
- Manage heads in the dashboard and in Discord.

## Approach

Change the URL whenever the cached image may be wrong. Discord's proxy and mc-heads' CDN key their cache by the full URL, so a new query string makes them fetch again. Every caller builds the URL through one function, so all places show the same image at the same time.

## Steps

0. **Check the premise first.** Fetch `https://mc-heads.net/avatar/Notch/64` with and without `?v=test` (a public name, not a user's) and compare the responses and their cache headers. If mc-heads rejects or ignores the query string, use a path form it accepts instead (for example `/avatar/<name>/64.png` against `/avatar/<name>/64`). If neither form bypasses its cache, stop and report back before building on it.
1. **One URL builder in core.** Move the builder to `src/core/utils/minecraft/playerHead.ts` (the dashboard needs it too, and bot code may not be imported from web). `playerHeadUrl(name, now = Date.now())` returns `https://mc-heads.net/avatar/<name>/64?v=<day>` or `...?v=<day>.<bump>`. `<day>` is the UTC day number. `<bump>` is the player's refresh token from the store, keyed by the lowercase name. `src/bot/utils/mcHeads.ts` re-exports it as `playerAvatarUrl` so the call sites do not change. The design note about "always by name" stays, plus one line on why the version exists.
2. **Head store.** `src/core/utils/stores/headStore.ts` on one kv key, `playerHeads`: `{ [lowerName]: { bump: string, refreshedAt: number, by: string } }`. `refreshHead(name, by)` writes a new bump (base36 time), `headInfo(name)` reads it. Kept small: an entry is written only on a manual refresh.
3. **Discord: `/skin`.** `/skin show (player)` shows the head the bot uses now (as the thumbnail), the URL, and the last manual refresh. `/skin refresh (player)` writes a new bump and shows the new head. Without `player` it acts on the caller's linked account, which any linked user may do. With another player's name it needs a bot admin. The command uses the existing name validation (`commands/shared/mcName.ts`) and the existing middleware. Strings in en and de.
4. **Dashboard.** The player detail answer gains the head version. The head route takes the same `?v=` and fetches that exact mc-heads URL, so the dashboard shows what Discord shows. The player panel in `PlayersView.vue` gets a "Refresh head" button behind `server:update`, backed by `POST /api/servers/:id/players/:name/head/refresh`. The button reloads the image after the call returns.
5. **Tests.** Unit tests: the URL builder (same URL for every caller on the same day, a new URL the next day, a new URL after a refresh, name lookup ignores case), the head store, `/skin` permissions (own head, another player as a non-admin is denied, admin allowed), and the dashboard route (capability check, refresh changes the version). The snapshot fixtures run on fixed time already, so `daily.json` and `events.json` change once to the new URLs. Regenerate and read them.
6. **Docs and changelog.** `docs/user/commands.md` (`/skin`), `docs/admin/permissions.md` (who may refresh whom), the dashboard players doc, and `CHANGELOG.md` under `[Unreleased]` with the touched files.
7. **Checks, once:** `npm run typecheck`, `lint`, `i18n:check`, `schema:check`, `layout:check`, `npm test`, and the em dash scan. Then one local commit on `main`.

## Verification

- Step 0 shows that a changed query string returns a freshly fetched image.
- Snapshot output: every head URL in `/daily`, the event embeds and the bridge carries the same `?v=` for the same player on the same day.
- An isolated `dev-up.mjs --id skin-cache --only web` session: the player panel shows the head and the Refresh button. Pressing it changes the head URL. Slash commands cannot run in a dev session, so `/skin` is covered by tests only.
- Full suite green.

## Not in scope

- No push, release or deploy until the owner asks.
- No override, no self-hosted renders, no change to `!playerhead` (the in-game item command).

## Risks

- Discord fetches each head again once a day. That is one small request per active player per day to mc-heads, which is negligible, but the day change means one more image load per player.
- If mc-heads itself has cached the default head for a name, a new URL fixes it only if the CDN key includes the query. Step 0 proves that before anything else is built.
- `/skin refresh` for one's own head is open to every linked user. It only changes a token, and the command rate limit applies.

## Deviation log

- Step 0 result: mc-heads' CDN (Cloudflare) ignores the query string. `?v=test1` and `?v=test2` returned the cached object of the plain URL (same ETag, `Age` 6087, HIT). A `?v=` version therefore refreshes only Discord's image proxy, not mc-heads' own cache, which has `max-age=21600` (6 h). Stopped before building, as the plan says, and asked the owner.
