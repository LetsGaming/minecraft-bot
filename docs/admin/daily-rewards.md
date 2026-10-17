# Configuring daily rewards

Players with linked accounts can claim a daily in-game reward with `/daily`. You can configure the rewards in two ways:

- **In the dashboard**, on the **Daily rewards** page: pick items by name, set each item's chance in percent (or as a weight), edit streak milestones and the bonus chance, and choose per server what it sets for itself. See [Editing in the dashboard](#editing-in-the-dashboard).
- **By hand**, in `data/dailyRewards.json` and the per-server `data/dailyRewards_<serverId>.json` files described below.

Both write the same files, and a save from either takes effect on the next `/daily` claim, without a restart.

## Where the files are

| File | What it is |
|---|---|
| `data/dailyRewards.defaults.json` | The balanced default pool shipped with the bot. Tracked in git and refreshed by updates. **Don't edit it**, your changes would conflict with the next update. |
| `data/dailyRewards.json` | The shared pool every server uses. Created from the defaults the first time the bot or the dashboard needs it, then never overwritten. Edit this one. |
| `data/dailyRewards_<serverId>.json` | Optional. One server's override, see [Per-server overrides](#per-server-overrides). |

To start over from the shipped defaults, delete `data/dailyRewards.json` (it is recreated on next use), or press **Start from the defaults** in the dashboard and save.

In Docker, `dailyRewards.defaults.json` is copied into the `bot_data` volume on every start, so it follows image updates; `dailyRewards.json` is created from it once and then belongs to you (`docker compose exec bot vi /app/data/dailyRewards.json`, or use the dashboard).

> **Upgrading from a version where `data/dailyRewards.json` was tracked in git:** if you edited that file, `git pull` refuses to update until you move your edits aside. Copy the file somewhere (`cp data/dailyRewards.json ~/dailyRewards.mine.json`), run `git checkout -- data/dailyRewards.json && git pull`, then copy it back to `data/dailyRewards.json`. If you never edited it, there is nothing to do.

## Editing in the dashboard

The **Daily rewards** page is listed under *Manage*. Pick what you're editing at the top: the **Shared pool (all servers)** or a single server.

- **Item pool.** Each row shows the item's name and id, the amount, its chance and the rarity tier `/daily` will show for it. Switch **Edit chance as** between *Percent* and *Weight*. Changing one item's percentage only changes that item's weight; the other items keep their proportions to each other, so their percentages shrink or grow together to make room. **Weights to 100** rescales all weights so they add up to 100 without changing any chance, after which each weight reads as its percent.
- **Adding items.** Search by name ("golden apple", "bottle o' enchanting") and pick from the list, or type any item id. Modded ids such as `create:brass_ingot` are accepted; the name list only covers vanilla items, so a modded item shows its id and a note that it isn't a vanilla item.
- **Streak milestones.** One card per day with its items and amounts. Add a day, add items to it, or remove either. The highest day sets the cycle length, see [the `streakBonuses` map](#the-streakbonuses-map).
- **Bonus chance.** The chance of a second, extra draw from the item pool on any claim.

On a server, each of the three sections has a switch. Off, the server uses the shared pool's value, shown read-only. On, the shared value is copied in as a starting point and the server keeps its own. When every switch is off, the override file is deleted.

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

- The player must have a [linked account](../user/linking.md) and be online on the server when claiming.
- Cooldown is 24 hours from the previous claim.
- A streak survives as long as claims are no more than 48 hours apart. Otherwise it restarts at 1.
- Items are delivered via the server console (`give` command), so they work without any server-side plugin.

**Claims are per server.** Cooldown, streaks, and claim history are tracked independently for every server instance: claiming on `survival` does not consume the daily on `creative`, and each server builds its own streak. On multi-server setups players pick the target with `/daily server:<id>` (their guild's default server is used otherwise), and `/streak` shows the streak for the resolved server.

The reward *configuration* (`data/dailyRewards.json`) is shared by default — every server hands out the same pool and milestones — but a server can override it (see below).

### Per-server overrides

To give one server a different pool without touching the shared `dailyRewards.json`, create `data/dailyRewards_<serverId>.json`, where `<serverId>` matches the server's id in `config.json`. It uses the same shape as `dailyRewards.json`, but every field is optional and applies only to that server:

```json
{
  "default": [
    { "item": "totem_of_undying", "amount": 1, "weight": 1 }
  ]
}
```

Any field this file omits (`default`, `streakBonuses`, `bonusChance`) falls back to the shared pool in `dailyRewards.json`, so a server can override just the items and keep the shared streak bonuses (or vice versa).

This file is never tracked in git, so per-server tuning never conflicts with an update of the shipped defaults.

> **Removed:** the older `servers.<id>` block inside `dailyRewards.json` is no longer read. If your shared file still has one, the bot logs a warning and ignores it, and the dashboard lists it as a problem. Move each entry to its own `data/dailyRewards_<id>.json` with the same contents.

Claim state is stored in `data/claimedDaily.json`, keyed by server and Discord user. Deleting a user's entry under a server resets them there. Files from older bot versions (one flat user map, no server dimension) are migrated automatically on first start: all existing streaks move under the **first configured server** — exact for single-server setups; on multi-server setups the log names the target so you can move entries manually if needed.

## Tips

- Validate the JSON after editing (`python3 -m json.tool data/dailyRewards.json` or any JSON linter). If the file is unreadable, `/daily` answers "Daily rewards data unavailable" instead of crashing. Entries that are readable but invalid (an item id with spaces, an amount of 0, a negative weight) are skipped and logged once; the dashboard lists them too.
- Item IDs must exist in your server's Minecraft version; an invalid ID makes the `give` command fail silently on the server side, with the claim still consumed.
- Modded item IDs (e.g. `create:brass_ingot`) are supported: any ID that already contains a namespace (`:`) is passed through unchanged; only bare IDs like `diamond` get the `minecraft:` prefix.

## Claim reminders

Users can opt in to a DM reminder with `/daily-reminder enabled:true` — per server, like the claims themselves (`/daily-reminder enabled:true server:creative` on multi-server setups). The bot checks every 5 minutes for opted-in users whose 24-hour cooldown has expired and sends one DM per claim cycle (claiming again re-arms the reminder); when several servers have claim data, the DM names the server it is about. Users with closed DMs are skipped silently until their next claim. The opt-in flag and reminder bookkeeping live in `data/claimedDaily.json`.
