# Configuring daily rewards

Players with linked accounts can claim a daily in-game reward with `/daily`. Everything about the rewards is configured in `data/dailyRewards.json`. The repo ships a complete, balanced default set; you can use it as-is or replace every item.

In Docker, the shipped file is seeded into the `bot_data` volume on first start. Edit the copy in the volume after that (`docker compose exec bot vi /app/data/dailyRewards.json`, or copy it out and back in).

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
| `item` | Yes | Minecraft item ID. The `minecraft:` prefix is optional; the bot adds it. |
| `amount` | No (default 1) | How many to give. |
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

## How claiming works (rules enforced by the bot)

- The player must have a [linked account](../user/linking.md) and be online on the server when claiming.
- Cooldown is 24 hours from the previous claim.
- A streak survives as long as claims are no more than 48 hours apart. Otherwise it restarts at 1.
- Items are delivered via the server console (`give` command), so they work without any server-side plugin.

Claim history and streaks are stored per Discord user in `data/claimedDaily.json`. Deleting a user's entry there resets them completely.

## Tips

- Validate the JSON after editing (`python3 -m json.tool data/dailyRewards.json` or any JSON linter). If the file is unreadable, `/daily` answers "Daily rewards data unavailable" instead of crashing.
- Item IDs must exist in your server's Minecraft version; an invalid ID makes the `give` command fail silently on the server side, with the claim still consumed.
- Modded item IDs (e.g. `create:brass_ingot`) are supported: any ID that already contains a namespace (`:`) is passed through unchanged; only bare IDs like `diamond` get the `minecraft:` prefix.

## Claim reminders

Users can opt in to a DM reminder with `/daily-reminder enabled:true`. The bot checks every 5 minutes for opted-in users whose 24-hour cooldown has expired and sends one DM per claim cycle (claiming again re-arms the reminder). Users with closed DMs are skipped silently until their next claim. The opt-in flag and reminder bookkeeping live in `data/claimedDaily.json`.
