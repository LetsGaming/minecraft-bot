---
approved: 2026-11-20T10:44:36.957Z
session: 5d1018cc-614e-47ea-9ed1-8a03cd257d51
status: active
---

<!-- Written by the save-plan hook. Record deviations below the plan. -->
# Wider daily reward pool with amount ladders, then release 8.5.2 and apply it on prod

## Context

After release 8.5.1 the prod pool still has no tiers. Deploying code never changes the live pool (`/app/data/dailyRewards.json` in the `bot_data` volume), so every entry reads as common. The owner wants more kinds of rewards and more amounts per item (for example 16x logs as common, 64x logs as rare), pushed and deployed on prod.

## Findings (read-only checks on prod and in the repo)

- Prod pool: 55 hand-picked entries (builder blocks, froglights, cosmetics, trophies), custom weights, 3 % bonus chance, 13 streak days. No per-server `dailyRewards_<id>.json` files exist, so nothing points at entry ids.
- The prod streak bonuses are identical to the shipped ones. Only the pool and `bonusChance` differ.
- The dashboard has a vanilla item catalog, `src/web/frontend/src/data/minecraftItems.json` (Java 26.1, 1505 items). All current default ids exist in it. It lists `iron_chain` and not `chain`, so renamed ids are a real risk. The prod servers run 26.3, newer than the catalog.
- The container has the compiled parser at `/app/src/core/dist/utils/stores/rewardsConfig.js`, so the live file can be checked with the bot's own code.

## Owner decisions

- Reward types: builder, decor and cosmetics, plus survival staples (food, ingots, redstone, farming items, mob drops).
- Prod: replace the live pool with the shipped defaults. Keep prod's own `streakBonuses` and the 3 % `bonusChance`. The 55 hand-picked entries and their weights are dropped.
- Release: cut v8.5.2.

## Design

**Amount ladders.** One item appears at several tiers with a growing amount. The amount depends on the item class:

| Class | Examples | common | uncommon | rare | epic |
|---|---|---|---|---|---|
| bulk | logs, planks, stone, cobblestone, deepslate, sand, glass, wool, concrete | 16 | 32 | 64 | 128 |
| block | bricks, quartz, prismarine, purpur, blackstone, sandstone | 8 | 16 | 32 | 64 |
| fancy | froglights, lanterns, candles, lamps, end rods, amethyst blocks | 4 | 8 | 16 | 32 |
| food | bread, cooked meat, golden carrot, pumpkin pie | 8 | 16 | 32 | 64 |
| metal | iron, copper, gold ingots | 4 | 8 | 16 | 32 |
| dust | redstone, coal, lapis, quartz, bone meal, gunpowder | 8 | 16 | 32 | 64 |
| drop | ender pearl, blaze rod, slime ball, phantom membrane | none | 4 | 8 | 16 |
| gem | emerald (uncommon 4, rare 8, epic 16), diamond (rare 2, epic 4, legendary 8) | | | | |

- Flagship staples (logs, planks, stone) appear in all four tiers. Niche items appear in two or three. Every entry is unique per (item, amount), and one item has at most one entry per tier.
- Dirt tier stays single items. Trophies (heads, discs, sherds, patterns, trims, templates) stay x1 in epic or legendary.
- The progression skips stay legendary and x1 (elytra, nether star, totem, conduit, dragon egg, heavy core, netherite upgrade template). Netherite, mending books and beacon parts are never added.
- New families: all wood types (oak, spruce, birch, jungle, acacia, dark oak, mangrove, cherry, bamboo, pale oak) as logs and planks; all 16 colors of concrete, terracotta, glazed terracotta, stained glass, wool and candles (two tiers each, to keep the table readable); copper and its oxidation stages; nether, end, ocean, mud, sandstone and ice families; flowers, saplings, crops; food; ingots, dust and gems; mob drops; redstone parts and rails; lights and decor. Tools, weapons and armor are not added.
- In-tier weight is 1 for ladder entries. Legendary singles keep their old relative weights (dragon egg lowest). Tier chances stay at the defaults (2.42, 44, 28, 16, 7.58, 2).
- Target size: about 650 entries, hard limit 1000 (the format allows 2000). `since` is set on items newer than 1.20 (cherry and bamboo 1.20, pale oak and resin 1.21.4, and so on). Ids that were renamed in recent versions are avoided (`chain`), and anything newer than 26.1 is left out.

## Steps

1. **Generate the pool.** A throwaway script in the scratchpad (not committed) holds the families and ladders, writes `data/dailyRewards.defaults.json`, and formats it with the repo's own `formatRewardsDocument` from `src/core/dist`. It aborts on a duplicate (item, amount), an id missing from the catalog, or a non-increasing ladder.
2. **Tests** in `tests/schema/dailyRewards.test.ts` (shipped pool block): every item id exists in `minecraftItems.json`; for an item with several entries the amount rises with the tier; no entry above 128 in common to rare except epic bulk rules; every tier has at least 20 entries; an item has one entry per tier; the existing dirt, progression and version tests stay.
3. **Docs and changelog.** `docs/admin/daily-rewards.md` (Tiers section: amount ladders and what the shipped pool contains), `CHANGELOG.md` under `[Unreleased]` (Changed: wider pool and ladders; note that existing pools are unchanged).
4. **Checks, once:** `npm run typecheck`, `lint`, `i18n:check`, `schema:check`, `layout:check`, `npm test`. Also a local simulation with the schema code: print the per-tier counts, the effective odds, and 20 sample claims.
5. **Commit and push** to `main` (conventional commit, no scope). Watch CI and the wrapper contract run; fix anything red.
6. **Release v8.5.2:** `node scripts/bump-version.mjs 8.5.2 --push --yes`, watch the Release workflow (gate, then publish). If the gate fails, fix it and cut v8.5.3; no tag is moved.
7. **Deploy code** on `docker:/apps/minecraft-bot`: `git pull --ff-only` (tree is clean), `docker compose up -d --build`, and `docker compose --profile web up -d --build web` (the dashboard is behind the `web` profile). Check both are healthy and the bot log has no errors.
8. **Apply the pool on prod** (separate step, because deploying code does not touch the live file):
   - Back up in the container: `cp /app/data/dailyRewards.json /app/data/dailyRewards.json.bak-pre-wide-20261120`, and keep a copy on the host.
   - Build the live document locally: new `default` and `tierChances` from the shipped file, prod's current `streakBonuses`, `bonusChance` 3, ids assigned with `assignIds`. Validate it with `parseRewardPool`.
   - Write it through the container as the `node` user (write to a temp name in `/app/data`, then `mv`), so ownership is right. The bot and dashboard read it through the mtime cache; no restart.
   - Verify with the container's compiled parser: no problems, per-tier counts, effective odds, streak days unchanged, bonus chance 3.
9. **Report** counts, odds, sample ladders, the backup paths and how to roll back.

## Verification

- Local: the six checks and the full suite, the simulation output, and a catalog check of every id.
- CI and the Release workflow green for the tag.
- Prod: both containers healthy, no `[ERROR]` in the bot log after restart, the live file parses with no problems, tier counts and odds match the local simulation. The dashboard Rewards page answers HTTP 200. I cannot claim in Discord, so a real `/daily` is left to the owner.

## Rollback

Restore `/app/data/dailyRewards.json.bak-pre-wide-20261120` over the live file (instant, no restart). For code, redeploy `v8.5.1`.

## Risks

- The live pool replacement drops the 55 hand-picked entries and their weights. The backup keeps them.
- Survival staples change what the daily gives: iron, redstone, food and drops now appear. This was chosen; tier chances keep the larger amounts rare.
- Items newer than 26.1 are not covered by the catalog check. A bad id is safe: the server rejects it and it moves to the failed list.
- A wide pool with ~650 entries makes the dashboard table long; filter chips and paging already exist.

## Deviations

- Step 1: the generated pool has 907 entries (dirt 24, common 218, uncommon 247, rare 251, epic 129, legendary 38), not about 650. Reason: the color families (16 colors x wool, concrete, terracotta, glass, glazed terracotta) and the ladders add up. It is below the 1000 limit and the dashboard pages and filters the table.
