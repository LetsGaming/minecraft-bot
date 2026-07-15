# Data storage

Runtime state lives under `data/` (the `bot_data` volume in Docker) in two media. **Ownership decides the medium:**

- **Human-authored, machine-read → JSON.** An operator writes it in an editor; readability and hand-editability are the point (`config.json`, `dailyRewards.json`).
- **Machine-written → SQLite** (`data/bot.db`). Two processes (bot + dashboard) write state concurrently; transactional read-modify-write is the point.

As of v4.0 the rule is fully applied: every machine-written store lives in SQLite. What remains as JSON is hand-edited configuration plus two process contract files (below).

## The SQLite store (`data/bot.db`)

Built on better-sqlite3 behind a small driver seam (`src/core/db/driver.ts`); `MCBOT_SQLITE_DRIVER=node` switches to the built-in `node:sqlite` for hosts without a compile toolchain (Node ≥ 22.13) — same SQL, same synchronous semantics either way. Opened by **both** processes in WAL mode with `busy_timeout`, so readers never block the writer and colliding writers wait instead of failing. `withTransaction()` (BEGIN IMMEDIATE) makes read-modify-write atomic — the property the JSON mutex never had, in-process or across processes.

| Table | Written by | Content |
|---|---|---|
| `admin_audit` | bot **and** dashboard | Every admin-gated action: who, what, which server, which guild. Capped at 500 rows. This table is why the DB exists — both processes append, and the JSON file lost entries to that race. |
| `whitelist_audit` | `/whitelist`, `/unwhitelist` | Latest add/remove per player, keyed by lowercased username |
| `linked_accounts` | `/link` flow, dashboard-free | `discord_id → mc_name`; case-insensitive index backs the "name already owned" rule |
| `link_codes` | `/link`, `!link` | Pending codes with expiry; the whole confirm flow is one transaction |
| `kv_store` | many single-owner stores | Versioned-blob stores, one row each, keyed by the legacy filename stem: `watches`, `playerNotes`, `waypoints`, `sessions`, `challenges`, `polls`, `claimedDaily`, `pendingRewards`, `statusMessages`, `leaderboardSchedule`, `updateNotifier`, `consoleRelay`, `milestones`, `whitelistApplications`. Each keeps its load/save API; `kvUpdate()` makes read-modify-write one transaction. |
| `uptime_checks` | downtime monitor | One row per check (`server_id`, `t`, `up`), capped at 43,200 per server (30 days at one check/minute). One INSERT per check — the JSON version rewrote the whole array. |
| `player_count_hours` | status pass / sampler | One row per server per hour (`sum`, `max`, `samples`); recording is a single UPSERT. 14-day retention. |
| `snapshots` | leaderboard scheduler | Hourly full stat snapshots, keyed `(server_id, ts)` — see the snapshots section below |
| `schema_migrations` | migration runner | Applied migration ids, plus each one's SQL checksum |

**Migrations** are embedded in `src/core/db/migrations.ts` (append-only) and run idempotently at startup of both processes — whichever starts first, or alone, has a current schema. "Append-only" is enforced rather than merely documented: each applied migration's SQL checksum is recorded, and a migration whose SQL changed after it was applied refuses to start, because the database still reflects the *old* statements while the code assumes the new ones. Whitespace is normalized before hashing, so reformatting is free and a real edit is not. Databases written before the checksum column existed adopt their current SQL as a baseline on the next start; there is nothing to compare against for those rows. On first start after upgrading, each store imports its legacy JSON file once (inside the same transaction that checks the target is empty) and renames the source to `*.imported`; the old `snapshots/` directory becomes `snapshots.imported/`. Inspect or delete at leisure — nothing is destroyed.

**Backups:** the `data/` volume backup keeps working, with one caveat — copying `bot.db` mid-write requires its `-wal`/`-shm` siblings too. For a consistent single-file backup use `sqlite3 data/bot.db "VACUUM INTO 'backup.db'"` (or stop the processes first). Deleting `bot.db` resets the migrated features and nothing else — and re-imports any `*.json` legacy files still present.

## The JSON files

| File | Written by | Content |
|---|---|---|
| `dailyRewards.json` | admin (by hand) | Reward pool and streak bonuses; read-only for the bot — hand-edited, which is exactly why it stays JSON |
| `runtime.json` | bot heartbeat | Liveness beacon the dashboard reads. A process contract file, not a store: it must stay readable with `cat` when everything else is broken |
| `commandManifest.json` | bot at startup | Discovered commands for the dashboard's policy editor. Regenerated every boot — a handoff artifact, not state |

Plus `config.json` / `config.template.json` at the repo root. Everything is auto-created on first use.

## Access layer for JSON: `loadJson` / `saveJson`

The remaining JSON reads/writes go through `utils/jsonStore.ts`:

- **Read cache by mtime.** `loadJson` stats the file; if the mtime matches the cached entry, no disk read happens. External edits are picked up automatically because they change the mtime.
- **Per-file write lock.** `saveJson` chains each write onto the previous write to the same path via a promise map, so *writes* serialize. Know its limits: it does **not** make read-modify-write atomic (two loads followed by two queued saves still lose the first update), and it is per-process — it guards nothing against the dashboard. State with either of those needs belongs in SQLite; that boundary is exactly why the migrated stores moved.
- **Failure mode.** A *missing* file returns `{}` — that is a first run. Anything else (truncated file, bad permissions, corrupt JSON) is not: `loadJson` logs, tries the `.bak` sibling `saveJson` keeps, and throws if that fails too. Returning `{}` there would let the next save overwrite whatever survived on disk and make the loss permanent. Callers treat empty-object as "no data yet" and let the throw propagate.

The rule from the guidelines follows from this: never `fs.writeFile` a state file directly, always `saveJson`, or you bypass both the cache coherence and the lock.

## In-memory caches

| Cache | Where | Lifetime | Invalidation |
|---|---|---|---|
| Whitelist + usercache per server | `minecraft/whitelist.ts` | 60 s TTL | `invalidateWhitelistCache(serverId)` — called by `/whitelist`, `/verify`, and `/unwhitelist`; the TTL covers edits made outside the bot |
| All player stats per server | `minecraft/statUtils.ts` | 30 s TTL | TTL, plus explicit invalidation after snapshots and stat deletion |
| `/list` output per server | `minecraft/playerUtils.ts` | 500 ms | TTL |
| Seed, TPS-command support | `ServerInstance` | process lifetime | none |
| Mod list per server | `minecraft/modUtils.ts` | keyed by file mtime | automatic when `downloaded_versions.json` changes |
| Config | `config.ts` | until file change | `fs.watch` hot reload (debounced), `/config reload` |

## Where player stats live on disk

Minecraft writes one `<uuid>.json` per player, and **not always in the same
place**:

| Layout | Path | Seen on |
|---|---|---|
| Vanilla | `<serverDir>/<level-name>/stats/` | Unmodded servers; the documented default |
| Modded | `<serverDir>/<level-name>/players/stats/` | A Fabric instance in the field, alongside `players/advancements/` |

`statsDir()` in `server/serverAccess.ts` probes for these in order and returns
the first that exists; the wrapper's `resolveStatsDir()` does the same for
remote instances. When neither exists — a fresh world, before anyone has
played — both return the vanilla path so messages name the expected location,
and neither caches that miss, since the server creates the directory the first
time somebody joins.

**Probe, never assume.** With the wrong directory every read is an `ENOENT`,
and `ENOENT` is exactly what a world nobody has played on looks like. So a path
mismatch reads as "no stats yet": `listStatsUuids` returns `[]` with a 200, the
bot believes it, every leaderboard is blank, and nothing in the chain logs an
error. That is not hypothetical — it is how this was found. If you add a third
layout, add it to `STATS_DIR_CANDIDATES` at both ends; the wrapper logs which
directory it settled on at startup.

## Snapshots

The leaderboard scheduler writes a full stat snapshot every hour per server into the `snapshots` table, keyed `(server_id, ts)` — the payload is the same document the old files held (legacy files of both historical layouts are imported into the table on startup, and the directory is retired as `snapshots.imported/`):

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

### Retention

Pruning runs after every snapshot, and its shape is dictated by those two
readers rather than by storage alone:

1. **Full resolution for the last 26 hours.** Both daily readers need
   snapshot-interval granularity on either side of the 24h boundary — one wants
   the newest snapshot just outside it, the other the oldest just inside.
   Nothing in this window is thinned.
2. **One per local day beyond it**, which is all the weekly and monthly boards
   need; their baseline lands within a day of the period start, and the footer
   reports the age it actually used.
3. **Nothing past the hard cap**, which is derived from
   `LONGEST_LEADERBOARD_INTERVAL_MS` (monthly) plus a day for the thinning
   granularity plus a day of slack — currently 32 days. It is derived rather
   than typed out so a new interval cannot outlive the history it needs.
4. **The newest snapshot always survives**, whatever its age, so a board on a
   long-idle server still has a baseline.

The window is *rolling*, and that is the whole point. An earlier version thinned
by calendar day — a day collapsed to its last snapshot once that day's *first*
snapshot aged past 24h. Yesterday's 00:00 snapshot is over 24h old at any time
after midnight, so yesterday always collapsed, tearing a hole through the rolling
window exactly where every daily baseline is looked up. Scheduled daily boards
anchored 26–48h back instead of 24h (on a server the bot had not been running
long, that meant the oldest snapshot there was, so the "daily" board showed
what looked like all-time totals), and `/stats daily` quietly shortened its
window to whatever had survived. If you change retention, change
`tests/minecraft/snapshotUtils.test.ts` with it: the regression tests there assert the
retention and the reader contracts *together*, because either one alone is
meaningless.

Multi-server keying — the audit report's old top item — is solved structurally: `(server_id, ts)` is the table's primary key, so one server's players can never diff against another server's baseline.

## Backups

Back up the whole `data/` directory (or the `bot_data` volume). The JSON files restore by copying them back; for `bot.db` remember the WAL caveat above — either stop the processes first, include the `-wal`/`-shm` siblings, or take a consistent copy with `sqlite3 data/bot.db "VACUUM INTO 'backup.db'"`. Restoring is copying back and restarting; schema migrations bring an older database forward automatically, and JSON blobs are validated on read, so old data keeps working.
