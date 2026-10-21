# Configuring daily rewards

Players with linked accounts can claim a daily in-game reward with `/daily`. You can configure the rewards in two ways:

- **In the dashboard**, on the **Daily rewards** page: pick items by name, set each item's chance in percent (or as a weight), edit streak milestones and the bonus chance, preview what a claim gives, and make a server differ from the shared pool by exception. See [Editing in the dashboard](#editing-in-the-dashboard).
- **By hand**, in `data/dailyRewards.json` and the per-server `data/dailyRewards_<serverId>.json` files described below.

Both write the same files, and a save from either takes effect on the next `/daily` claim, without a restart.

## Where the files are

| File | What it is |
|---|---|
| `data/dailyRewards.defaults.json` | The balanced default pool shipped with the bot. Tracked in git and refreshed by updates. **Don't edit it**, your changes would conflict with the next update. |
| `data/dailyRewards.json` | The shared pool every server uses. Created from the defaults the first time the bot or the dashboard needs it, then never overwritten. Edit this one. |
| `data/dailyRewards_<serverId>.json` | Optional. One server's exceptions to the shared pool, see [Per-server exceptions](#per-server-exceptions). |

To start over from the shipped defaults, delete `data/dailyRewards.json` (it is recreated on next use), or press **Start from the defaults** in the dashboard and save.

In Docker, `dailyRewards.defaults.json` is copied into the `bot_data` volume on every start, so it follows image updates; `dailyRewards.json` is created from it once and then belongs to you (`docker compose exec bot vi /app/data/dailyRewards.json`, or use the dashboard).

> **Upgrading from a version where `data/dailyRewards.json` was tracked in git:** if you edited that file, `git pull` refuses to update until you move your edits aside. Copy the file somewhere (`cp data/dailyRewards.json ~/dailyRewards.mine.json`), run `git checkout -- data/dailyRewards.json && git pull`, then copy it back to `data/dailyRewards.json`. If you never edited it, there is nothing to do.

## Editing in the dashboard

The **Daily rewards** page is listed under *Manage*. Pick what you're editing at the top: the **Shared pool (all servers)** or a single server.

Above the settings, **What players get** shows the chance of each rarity as one bar, with the same numbers as text. **Preview a claim** rolls one claim from the pool as it is now, unsaved changes included, with the same draw the bot uses: pick a streak day and press *Roll* to see the reward, a lucky bonus if the bonus chance hits, and that day's milestone items. The settings are in three tabs:

- **Item pool.** One line per entry with its name and id, the amount, its chance and the rarity tier `/daily` will show for it. Filter by text or rarity, and sort by name, amount, chance or rarity. Switch **Edit chance as** between *Percent* and *Weight*. Changing one item's percentage only changes that item's weight; the other items keep their proportions to each other, so their percentages shrink or grow together to make room. In weight mode, **Rescale weights to 100** rescales all weights so they add up to 100 without changing any chance, after which each weight reads as its percent. The same item may appear several times with different amounts and weights.
- **Adding items.** Search by name ("golden apple", "bottle o' enchanting") and pick from the list, or type any item id. Modded ids such as `create:brass_ingot` are accepted; the name list only covers vanilla items, so a modded item shows its id and a note that it isn't a vanilla item.
- **Streak milestones.** The milestone days as a strip, with a thin track above showing where they fall in the cycle. Click a day to edit its items in the panel beside it (a sheet on phones); add a day, copy a day's items to another day, or remove it. The highest day sets the cycle length, see [the `streakBonuses` map](#the-streakbonuses-map).
- **Bonus chance.** The chance of a second, extra draw from the item pool on any claim, said in plain words ("about 1 in 20 claims").

Removing an item, a day or a reset shows an **Undo** for a few seconds. The bar at the top of the editor counts what you changed ("3 unsaved changes, 2 added, 1 removed") and **Review changes** lists each one as it was and as it will be.

### Editing a server

A server page shows the shared pool's entries and marks how this server differs. Nothing is copied: the server's file only records the differences, so later edits to the shared pool reach the server unless it opted out.

| Mark | Meaning |
|---|---|
| *(none)* | Follows the shared pool. |
| **Changed here** | This server uses its own amount or chance for the entry (the shared value is shown as "was ..."). Editing it back to the shared value drops the exception. |
| **Only here** | An entry only this server has. |
| **Not used here** | The server removed an entry the shared pool has. **Use again** brings it back. |
| **Kept from shared** | The server keeps its own copy of an entry. See below. |

**Keep as it is on this server** (the lock) detaches an entry: the server gets its own copy with its current values, and later changes to, or removal of, the shared entry no longer reach it. The link icon on a kept entry follows the shared one again. **Differences only** lists just the rows that differ, and each tab has a **Reset to shared** that drops all of this server's exceptions in it.

### Saving the shared pool

Saving the shared pool can change what servers hand out, and weights are relative, so removing one heavy item raises the chance of every other item. When servers inherit what you are about to change, a dialog lists, per server, the entries removed, changed or added. By default every server follows the change. Tick **Keep it as it is on this server** (for a removed or changed entry) or **Don't add it on this server** (for a new one) to write that exception into the server's file in the same save. Servers you can't edit are listed and follow the change. If a server's file can't take its change, nothing is saved.

**Who can edit.** Viewing needs `config:read`, saving needs `config:write`, the same capabilities as the [mod config editor](mod-configs.md). Someone holding them on one server can edit that server's override. The shared pool hands out items on every server, so it needs the capability under `"*"` (bot administrators always have it). See [capabilities.md](capabilities.md).

Every save is checked by the same rules the bot uses when it reads the files, and refused if anything is invalid. If someone else (or a hand edit) changed the file since you opened it, the save is refused rather than overwriting their change, and your edits are kept so you can review them and save again. Saves are recorded in the audit log.

## File structure

```json
{
  "default": [
    { "item": "experience_bottle", "amount": 16, "weight": 10 },
    { "item": "enchanted_golden_apple", "amount": 1, "weight": 1 }
  ],
  "streakBonuses": {
    "3":  [{ "item": "experience_bottle", "amount": 32 }],
    "14": [
      { "item": "diamond_block", "amount": 2 },
      { "item": "experience_bottle", "amount": 64 }
    ]
  }
}
```

### The `default` pool

Every claim grants exactly one item from this pool, picked by weighted random:

| Field | Required | Description |
|---|---|---|
| `item` | Yes | Minecraft item ID. The `minecraft:` prefix is optional; the bot adds it. An item-components (`[...]`) or NBT (`{...}`) suffix is allowed. |
| `amount` | No (default 1) | How many to give, 1 to 6400. |
| `weight` | No (default 1) | Relative draw probability. An item with weight 10 is drawn ten times as often as one with weight 1. Fractional weights like `0.4` work. |
| `id` | No | A short stable name for the entry, unique within its list. The dashboard writes one on every entry when it saves. The same item may be listed several times with different amounts and weights, so the item can't name an entry; the id is what a server's exceptions point at. An entry without one is identified by a name derived from its item and its place among the entries for that item. |

The chance of a specific item is its weight divided by the sum of all weights. Keep common filler at high weights and rare prizes at low ones.

### The `streakBonuses` map

Keys are streak day numbers as strings. When a player's bonus streak hits that exact number, they get all listed items on top of the regular reward:

```json
"streakBonuses": {
  "3":   [ ...items for day 3... ],
  "121": [ ...items for day 121... ]
}
```

The highest key defines the bonus cycle length. After reaching it, the player's bonus counter restarts at 1 (so milestone bonuses repeat), while their visible streak keeps counting up.

### `bonusChance`

Optional, 0 to 100 (default 0). The chance, in percent, that a claim draws a second item from the `default` pool on top of the first. Independent of streak bonuses.

## How claiming works (rules enforced by the bot)

- The player must have a [linked account](../user/linking.md). If they are offline, the reward is queued and delivered on their next join (at most 3 waiting per player); the claim and the streak count either way.
- Cooldown is 24 hours from the previous claim.
- A streak survives as long as claims are no more than 48 hours apart. Otherwise it restarts at 1.
- Items are delivered via the server console (`give` command), so they work without any server-side plugin.

**Claims are per server.** Cooldown, streaks, and claim history are tracked independently for every server instance: claiming on `survival` does not consume the daily on `creative`, and each server builds its own streak. On multi-server setups players pick the target with `/daily server:<id>` (their guild's default server is used otherwise), and `/streak` shows the streak for the resolved server.

The reward *configuration* (`data/dailyRewards.json`) is shared by default — every server hands out the same pool and milestones — but a server can override it (see below).

### Per-server exceptions

To give one server a different pool without touching the shared `dailyRewards.json`, the dashboard (or you, by hand) creates `data/dailyRewards_<serverId>.json`, where `<serverId>` matches the server's id in `config.json`. It lists only how that server differs from the shared pool:

```json
{
  "default": {
    "add":    [{ "item": "totem_of_undying", "amount": 1, "weight": 1, "id": "k3f9" }],
    "remove": ["1bqqade#1"],
    "set":    { "1a5ohxd#1": { "item": "blaze_rod", "weight": 5 } }
  },
  "streakBonuses": {
    "removeDays": ["3"],
    "days": { "14": { "add": [{ "item": "diamond", "amount": 3, "id": "m81" }] } }
  },
  "bonusChance": 5
}
```

| Key | Meaning |
|---|---|
| `add` | Entries only this server has. Each needs an `id`. |
| `remove` | Ids of shared entries this server does not use. |
| `set` | Shared entry id to the new `amount` and/or `weight` this server uses. `item` records which entry it is about. Only the fields named are replaced. |
| `streakBonuses.days` | The same `add` / `remove` / `set` per milestone day; a day not in the shared pool is new. |
| `streakBonuses.removeDays` | Shared milestone days this server does not have. |
| `bonusChance` | This server's own bonus chance (a single value, so it replaces the shared one). |

Anything not mentioned follows the shared pool, so a new item added to the shared pool reaches the server. A server can't be left without items, nor a milestone day without items; such a file is refused when saved from the dashboard and falls back to the shared items when read. A `remove` or `set` whose entry no longer exists in the shared pool is ignored (the editor warns about a customised entry that was deleted). Because ids are what exceptions point at, edit the shared pool in the dashboard when servers have exceptions: it keeps every entry's id and shows what a change does to each server. If you edit it by hand, keep the `id` of every entry you keep.

This file is never tracked in git, so per-server tuning never conflicts with an update of the shipped defaults.

> **Removed:** the older `servers.<id>` block inside `dailyRewards.json` is no longer read. If your shared file still has one, the bot logs a warning and ignores it, and the dashboard lists it as a problem. Move each entry to its own `data/dailyRewards_<id>.json`.

#### Upgrading from whole-field overrides

Before this format, a server file held whole replacements: `"default": [ ...every item... ]`, `"streakBonuses": { "3": [...] }`. The first start after the upgrade converts the files, in both the bot and the dashboard:

1. The shared `dailyRewards.json` gets an `id` on every entry.
2. Each old server file is rewritten as exceptions to the shared pool, and the result is checked to give exactly the rewards the old file did (same entries, same weights, same milestone days, same bonus chance).
3. The original of every rewritten file is kept next to it as `<file>.pre-exceptions.bak`. The first copy is never replaced by a later run.

A file with problems of its own (an invalid entry, unreadable JSON) is left as it is and reported in the log; it keeps working, read as exceptions on the fly. An override that was an exact copy of the shared pool becomes "follows the shared pool" and its file is removed, so from then on shared edits reach that server. To look first, run `npm run rewards:migrate -- --dry-run` after `npm run build`: it lists what each file would become and which servers would start following the shared pool, and writes nothing. To go back to an older version, restore the `.pre-exceptions.bak` files over the originals (an older version can't read the new format).

Claim state is stored in the database (`kv_store["claimedDaily"]` in `data/bot.db`), keyed by server and Discord user. `/daily-admin reset` clears a user's record on a server. Files from older bot versions (one flat user map, no server dimension) are migrated automatically on first start: all existing streaks move under the **first configured server** — exact for single-server setups; on multi-server setups the log names the target so you can move entries manually if needed.

## Tips

- Validate the JSON after editing (`python3 -m json.tool data/dailyRewards.json` or any JSON linter). If the file is unreadable, `/daily` answers "Daily rewards data unavailable" instead of crashing. Entries that are readable but invalid (an item id with spaces, an amount of 0, a negative weight) are skipped and logged once; the dashboard lists them too.
- Item IDs must exist in your server's Minecraft version; an invalid ID makes the `give` command fail silently on the server side, with the claim still consumed.
- Modded item IDs (e.g. `create:brass_ingot`) are supported: any ID that already contains a namespace (`:`) is passed through unchanged; only bare IDs like `diamond` get the `minecraft:` prefix.

## Claim reminders

Users can opt in to a DM reminder with `/daily-reminder enabled:true` — per server, like the claims themselves (`/daily-reminder enabled:true server:creative` on multi-server setups). The bot checks every 5 minutes for opted-in users whose 24-hour cooldown has expired and sends one DM per claim cycle (claiming again re-arms the reminder); when several servers have claim data, the DM names the server it is about. Users with closed DMs are skipped silently until their next claim. The opt-in flag and reminder bookkeeping live in the same store.
