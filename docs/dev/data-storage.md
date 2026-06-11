# Data storage

There is no database. All runtime state is JSON under `data/` (the `bot_data` volume in Docker). This page documents every file, who writes it, and the caching rules around it.

## The files

| File | Written by | Content |
|---|---|---|
| `linkedAccounts.json` | `/link` flow | `{ discordId: minecraftName }` |
| `linkCodes.json` | `/link`, `!link` | Pending codes: `{ code: { discordId, expires, confirmed } }`. Codes expire after 5 minutes. |
| `claimedDaily.json` | `/daily` | Per Discord user: last claim, streaks, full reward history |
| `dailyRewards.json` | admin (by hand) | Reward pool and streak bonuses; read-only for the bot |
| `whitelistAudit.json` | `/whitelist`, `/unwhitelist` | Who added/removed whom, when, on which server |
| `leaderboardSchedule.json` | leaderboard scheduler | Last post timestamp per guild |
| `statusMessages.json` | status embed | Provisioned category/channel/message IDs per guild |
| `uptimeHistory.json` | downtime monitor | Per server: array of `{t, up}` checks, capped at 10,080 entries |
| `snapshots/<serverId>/<timestamp>.json` | leaderboard scheduler | Hourly stat snapshots, one directory per server (see below) |

Everything is auto-created on first use. Deleting a file resets that feature's state and nothing else.

## Access layer: `loadJson` / `saveJson`

All of the above (except snapshots, which use raw `fs` because each file is written once) goes through `utils/utils.ts`:

- **Read cache by mtime.** `loadJson` stats the file; if the mtime matches the cached entry, no disk read happens. External edits are picked up automatically because they change the mtime.
- **Per-file write lock.** `saveJson` chains each write onto the previous write to the same path via a promise map. Two concurrent `/link` completions serialize instead of last-write-wins clobbering. A failed write resets the chain rather than poisoning all future writes.
- **Failure mode.** `loadJson` returns `{}` on any error (missing file, bad JSON). Callers must treat empty-object as "no data yet".

The rule from the guidelines follows from this: never `fs.writeFile` a state file directly, always `saveJson`, or you bypass both the cache coherence and the lock.

## In-memory caches

| Cache | Where | Lifetime | Invalidation |
|---|---|---|---|
| Whitelist per server | `utils.ts` | 60 s TTL | `invalidateWhitelistCache(serverId)` — called by `/whitelist`, `/verify`, and `/unwhitelist`; the TTL covers edits made outside the bot |
| All player stats per server | `statUtils.ts` | 30 s TTL | TTL, plus explicit invalidation after snapshots and stat deletion |
| Level name per server | `utils.ts` | unbounded | none (changes require restart) |
| `/list` output per server | `utils.ts` | 500 ms | TTL |
| Seed, TPS-command support | `ServerInstance` | process lifetime | none |
| Mod list per server | `modUtils.ts` | keyed by file mtime | automatic when `downloaded_versions.json` changes |
| Config | `config.ts` | until file change | `fs.watch` hot reload (debounced), `/config reload` |

## Snapshots

The leaderboard scheduler writes a full stat snapshot every hour per server to `data/snapshots/<serverId>/<epochMs>.json` (legacy loose files are migrated into the first server's directory on startup):

```json
{
  "version": 2,
  "timestamp": 1718000000000,
  "players":   { "<uuid>": { "playtime": 123, "mined": 456, ... } },
  "flatStats": { "<uuid>": { "minecraft:custom.minecraft:play_time": 123, ... } }
}
```

`players` holds only the leaderboard-relevant values (small, hot path for period leaderboards); `flatStats` holds the full flattened stat map (used by `/stats daily` diffs). Version 1 snapshots lack `flatStats` and are skipped by the daily diff.

Two readers:

- `getSnapshotClosestTo(target)`: newest snapshot at or before the target; falls back to the oldest available so a young bot still gets a partial-period baseline. Used by scheduled leaderboards.
- `getSnapshotForDailyDiff(target)`: oldest v2 snapshot at or after `now - 24h`, so the daily window never silently exceeds 24 hours. Returns null when no baseline exists yet.

Pruning runs after every snapshot: hourly resolution is kept for the last day, then one per day, nothing past 31 days, and the newest snapshot is always kept regardless of age.

Note for multi-server work: snapshots are currently keyed only by timestamp, not by server. With more than one server, baselines mix. This is the top item in the audit report; if you touch snapshot code, fix the keying first (per-server subdirectories) before building on it.

## Backups

Back up the whole `data/` directory (or the `bot_data` volume); it is small and everything in it is plain JSON. Restoring is copying the files back and restarting the bot. There is no schema migration machinery; new fields are optional-read so old files keep working.
