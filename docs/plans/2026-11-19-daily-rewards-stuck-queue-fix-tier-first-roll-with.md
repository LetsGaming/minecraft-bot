---
approved: 2026-11-19T21:27:40.366Z
session: 5d1018cc-614e-47ea-9ed1-8a03cd257d51
status: active
---

<!-- Written by the save-plan hook. Record deviations below the plan. -->
# Daily rewards: stuck queue fix, tier-first roll with dirt tier, missions research

## Context

Three requests from the owner (2026-11-19):

1. **Stuck queue entry.** An offline `/daily` claim replies "2/3". After the player joins and gets the new items, the queue still holds one entry ("1/3").
2. **Wider pool plus a "dirt" tier** of troll items (1x stick and similar).
3. **Missions research only:** daily, weekly and monthly per-player missions with a deadline and a reward. Decide if the effort is worth it (drop it if not), and research reward balance. The system must stay fair to players who do not use the bot.

### Findings

- **Queue root cause (code-level).**
  - `deliverPendingRewards` (`src/core/utils/minecraft/rewards.ts:151`) takes the queue, calls `give()` for each item, and requeues every failed item. There is no attempt counter.
  - `give()` (`rewards.ts:93`) counts as success only output that contains "Gave". So an item the server rejects (unknown id on that version, bad components, an id that fails `RESOURCE_ID`) stays queued forever and is retried on every join.
  - Likely sources: a pool item that the server version lacks, or a `/challenge` bonus item. `/challenge` never validates the item (`src/bot/commands/admin/challenge.ts:201`); it enqueues with `discordId ""` (`advancements.ts:100`).
  - The exact item is not known yet. It needs the production log line (see step 1).
- **Misleading counter.** `enqueuePending` returns `list.length` of all entries (`src/core/utils/stores/dailyStore.ts:201`). The cap counts only offline claims (`isQueuedClaim`, `dailyClaim.ts:32`). So owed and system entries inflate "n/3".
- **No admin tooling** exists to show or clear a player's pending queue.
- **Rarity is broken today.** `rarityOf` (`src/schema/dailyRewards.ts:646`) derives the tier from an item's share of the pool's total weight; legendary means a share of 2% or less. In the shipped 213-item pool the largest share is about 1%, so every item shows as legendary. Each new item also dilutes all other odds. The current troll items sit at weight 0.1 and are labelled legendary.
- **Version awareness.** The server version is available from the cached ping: `ServerInstance` (`src/core/utils/server/server.ts:305`) via `parseVersionName` (`src/core/utils/minecraft/versionName.ts`). It already handles both `1.x` and year-based `26.x`. Item validation is syntax-only (`itemProblem`, `dailyRewards.ts:110`).

### Owner decisions

- **Roll model:** tier-first. Each item has an explicit tier. A claim rolls the tier first, then an item inside that tier by weight.
- **Default tier chances (per claim, in %):**

  | Tier | Chance |
  |---|---|
  | dirt | 2.42 |
  | common | 44 |
  | uncommon | 28 |
  | rare | 16 |
  | epic | 7.58 |
  | legendary | 2 |

  Admins can edit these.
- **Production runs MC 26.3.** The pool must also work on older and future versions.
- **Progression-skip items** (elytra, netherite upgrade template, nether star, heavy core, totem, conduit, dragon egg) stay, but in the legendary tier only. Streak bonuses stay as they are.
- **Missions research** goes to a repo doc. No implementation.

## Steps

### 1. Diagnose the stuck entry (owner, not blocking)
Owner runs this on the production host:

`grep -E "Give not confirmed for LetsGamingDE420|Refused to give .*LetsGamingDE420" logs/bot.log | tail -5`

The item id it shows confirms the failure class. The fix below covers every class, so implementation does not wait for it. Record the result in this plan.

### 2. Queue fix (`@mcbot/core`, bot)
- **Classify `give()` results.** `give()` returns `"delivered" | "retry" | "rejected"` instead of a boolean.
  - `rejected`: `ConsoleArgumentError`, or output matching `Unknown item`, `Incorrect argument`, `Unknown or incomplete command`, or `Expected`. Reuse `COMMAND_NOT_RUN` from `src/core/utils/server/commandOutcome.ts:11` and extend it.
  - `retry`: `unreachable`, `No player was found`, or any other unrecognised output.
  - Update every caller: `dailyClaim.ts`, `rewards.ts`, `advancements.ts`.
- **Delivery (`deliverPendingRewards`).**
  - Rejected items move to a dead-letter list instead of the queue.
  - Each entry gets `attempts`. After 5 joins without delivery, its remaining items also move to dead letters.
  - Store dead letters in the same `pendingRewards` document, in a `failed` list per server with a bounded size and the same owning module (`dailyStore.ts`).
  - Log each dead letter at ERROR with player, item and RCON output.
  - `tellraw` the player one line saying a reward could not be delivered and an admin can see it.
- **Online claim path.** In `claimDaily`, rejected items go to dead letters, not to `owed`. After a successful online claim, flush older queued entries with `deliverPendingRewards`.
- **Counter.** Return the cap-relevant count (claims only) from the enqueue used by `/daily`, so "n/3" matches the cap.
- **Admin command `/daily-admin queue`:**
  - `show <user>`: queued entries plus dead letters.
  - `clear <user>`.
  - `retry <user>`: moves dead letters back to the queue.
  - Write an admin audit entry for each. Add en and de strings.
- **`/challenge start`:** validate `item` with `itemProblem` and refuse bad ids.

### 3. Tier-first roll (`@mcbot/schema` first, then core, bot, web)
- **Schema.**
  - Add `RewardRarity.Dirt` as index 0 of `REWARD_RARITIES` (`src/schema/embedCategories.ts:30`).
  - Give it a brown `RARITY_STYLE` entry.
  - Change `rarest()` (`rewards.ts:204`) to seed with `REWARD_RARITIES[0]`.
- **Data model.**
  - Pool entries gain a required `tier` and an optional `since` (minimum MC version, e.g. `"1.21.6"`).
  - `weight` now means relative weight inside the tier (default 1).
  - The pool gains `tierChances` (percent per tier, must sum to 100). Validate this in `src/core/configValidation.ts` / `rewardsConfig.ts`, and in the dashboard.
  - Per-server overrides can patch `tier` and `since`, and can override `tierChances`.
- **Roll (`src/schema/rewardRoll.ts`).**
  1. Filter out items whose `since` is above the server version. If the version is unknown, filter nothing.
  2. Pick the tier from `tierChances`, spreading the chance of empty tiers over the others in proportion.
  3. Pick an item by weight inside that tier.

  The random bonus uses the same roll; streak bonuses are unchanged. The dashboard preview uses the same function, so it stays in sync.
- **Version comparison helper** in schema. It orders `1.x < 2x.y` and compares dotted parts numerically. Unit-test it against `1.21.4`, `1.21.10`, `26.1`, `26.3.1`.
- **`rarityOf`** returns the stored tier. Remove the share thresholds and `MIN_DISTINCT_WEIGHTS_FOR_RARITY`.
- **Migration** for existing `dailyRewards.json` and overrides, following the `src/core/rewardsMigration.ts` pattern with a `.bak` backup.
  - Sort items by weight, highest first. Assign tiers by cumulative share of the old weight, using the new tier boundaries.
  - Keep old weights as in-tier weights.
  - Log a warning asking admins to review the tiers, or to use "start over from the defaults".
- **Embed (`dailyEmbeds.ts`).** Add a dirt label and colour, plus one playful line for a dirt roll.
- **Locales.** Add `daily.rarity.dirt` to `src/core/locales/{en,de}.ts` and `appearance.key.rarity.dirt` to the frontend `en.ts`.
- **Dashboard.**
  - `PoolTable`: an editable tier select instead of a derived chip, and a "needs X" badge for `since`.
  - `OutcomeStrip`: show the configured tier chances.
  - A tier-chances editor next to `BonusPanel`.
  - Filter chips include dirt.
  - `AppearanceView`: a colour picker for dirt.

### 4. Widen the default pool (`data/dailyRewards.defaults.json`)
- Rewrite with explicit tiers, in-tier weights, and `since` on every item added after 1.20.
- **Dirt tier (about 20 items, all x1):** stick, dirt, wheat seeds, rotten flesh, poisonous potato, dead bush, string, clay ball, bowl, egg, cobweb, gravel, feather, paper, gold nugget, pufferfish, a single bone, a single ink sac, and a single leather, among others.
- **Common to epic:** add items across every tier: building block sets, dyes, food, redstone parts, saplings, flowers, ores, utility items. Keep stack sizes at time-saver level.
- **Legendary:** the existing progression-skip items move here, with `dragon_egg` at the lowest in-tier weight. Streak bonuses stay unchanged, by owner decision.
- **Versions.** Pin item ids only for versions up to 26.1 that are verified against the Minecraft Wiki item list. My knowledge of 26.2 and 26.3 items is uncertain (my training data stops before them). Mark those additions as owner-verified, or leave them out. The rejection handling from step 2 is the safety net for any wrong id.
- Add a test that every default item id passes `itemProblem` and has a tier, that tiers are non-empty, and that `tierChances` sums to 100.

### 5. Missions research doc
- **File:** `docs/dev/research/2026-11-19-missions.md`.
- **Prior-art survey:** one `researcher` subagent (Sonnet), standard depth. Cover Hypixel and server quest plugins (Quests, BetonQuest, BattlePass-style plugins), battle-pass and daily-quest design write-ups, and player complaints about FOMO and grind.
- **Doc content:**
  - **Feasibility from the codebase.** Stats via the wrapper's `/stats` and `flattenStats` (any stat key). A per-assignment baseline stored at assignment time, an hourly progress checker on the `milestoneWatcher` pattern, a rollover scheduler on `nextLeaderboardRun`, migration 8 for an assignments table, a JSON pool with per-server exceptions, and payout through `give()` and the queue.
  - **Risks:**
    - Stats files only update on autosave or logout, so progress lags up to about 5 minutes. A `save-all` before final checks would close the gap.
    - Snapshot retention is 32 days.
    - Players can be renamed, so store the UUID.
    - Which clock decides the rollover.
    - AFK farms.
    - Stats reset when the world resets.
  - **An effort estimate and a go/no-go recommendation,** with an MVP cut: stat-based daily and weekly missions only.
  - **Reward balance rules:** rewards save time or add style, never skip progression. Rewards scale with effort and the frequency is capped. Missions should push varied gameplay, not grind. No streak punishment. Players without the bot lose nothing they need.
- Ends with a prioritized list of recommendations.

### 6. Docs, changelog, checks
- **Docs:** `docs/admin/daily-rewards.md` (tiers, `tierChances`, `since`, the queue command), `docs/dev/bot/replies.md:65` (remove the threshold text), `docs/GLOSSARY.md`, `docs/admin/configuration.md:297`.
- **Changelog:** a `CHANGELOG.md` entry under `[Unreleased]` covering the queue fix, the counter, the admin command, the tier roll, the dirt tier, the migration, and challenge validation.
- **Checks:** run once at the end, in this order: `npm run typecheck`, `npm run lint`, `npm run i18n:check`, `npm run schema:check` (and `schema:generate` if the config shape changed), `npm run layout:check`, then `npm test`.

## Acceptance criteria
- A queued entry whose item the server rejects leaves the queue on the next join and appears under `/daily-admin queue show`. A transient failure is still retried, at most 5 times.
- The "n/3" figure equals the number of offline claims counted by the cap.
- Over many seeded rolls, tier frequencies match `tierChances` within tolerance. Adding items to one tier does not change the other tiers' odds.
- On a server reporting `1.21.4`, no item with `since` above `1.21.4` is rolled.
- An existing pool migrates with a `.bak` file, and every entry gets a tier.
- The dashboard edits tiers and tier chances, and the preview matches the bot's roll.
- The missions doc exists with a go/no-go and a prioritized recommendation list.

## Verification
- **Unit tests:**
  - Extend `tests/commands/pendingDelivery.test.ts`: rejected items go to dead letters, the attempt limit applies, retries still happen.
  - `tests/commands/dailyClaim.test.ts`: the counter, the online flush.
  - `tests/db/dailyStore.test.ts`: dead-letter storage.
  - `tests/utils/rarity.test.ts`: six tiers, `rarest`.
  - New roll and version-compare tests in `tests/schema/`.
  - `tests/web/components/rewardsEditor.test.ts`: the segment count becomes 6.
  - A migration test.
- **Manual (dashboard):** `node scripts/dev-up.mjs --id dirt-tier --only web`. Edit tiers and chances, then check the preview and OutcomeStrip at desktop and mobile width. Finish with `dev-down.mjs --id dirt-tier`. The bot cannot `/give` without a real server, so delivery is covered by tests.
- **Production check after deploy:**
  1. The owner's stuck entry leaves the queue on the next join, or `/daily-admin queue clear` removes it.
  2. The next offline claim shows "1/3".

## Deviations

- Step 2: `give()` returns four statuses (`delivered`, `unreachable`, `unconfirmed`, `rejected`), not three. Reason: a wrapper outage (`unreachable`) says nothing about the item and must not use up one of the 5 attempts. Only `unconfirmed` counts.
- Step 2: `/daily-admin queue` takes an `action` choice (`show`, `clear`, `retry`) and an optional `player` name next to `user`, so system rewards for players without a Discord link can be inspected.
- Step 5: the researcher flagged that the "stats files only update on autosave or logout" claim is unverified (the Minecraft Wiki is silent). The missions doc marks it as an experiment to run, not a fact.
- Step 3: no automatic migration of existing pools, and no `.bak` rewrite. An entry without `tier` reads as common, so an existing pool has one filled tier and draws by weight exactly as before. Reason: a weight to tier mapping would be a guess (the old shares cannot be mapped to the new tier chances), and silent rewrites of an admin's file risk their custom pool. Admins assign tiers in the dashboard or use "start over from the defaults". Acceptance criterion "an existing pool migrates" becomes "an existing untiered pool rolls as before".
- Step 3: `tier` and `since` are optional in the type and parser (missing tier is common), not required. Reason: the loader must not drop every entry of an un-migrated file.
- Step 3: server overrides can patch `tier` and `since` per entry (`set`), and replace `tierChances` as one value (like `bonusChance`).
- Step 3: the dashboard editor work runs in a subagent (frontend only). Editing `since` of an existing row is not offered; it is set when adding an item and shown as a badge.
