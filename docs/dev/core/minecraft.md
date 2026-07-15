# Minecraft domain

`core/utils/minecraft/` — everything that reads or interprets the world and its
players. No Discord imports live here: rendering is `bot`'s job
(`bot/utils/embeds/statEmbeds.ts`), and keeping the split is what makes this
group testable without a client.

## Who the server knows

`whitelist.ts` answers "what is this UUID's name": the whitelist first (the
admin-managed canonical list), then `usercache.json` for everyone else, most
recently seen first. On a server with no whitelist that is just the usercache,
so stats, leaderboards, and autocomplete keep working. Both are cached per
server ID for 60 s, and bot-initiated edits invalidate directly.

`playerUtils.ts` sits on top: `findPlayer` (case-insensitive), the autocomplete
name list, and the online-player readers. The readers prefer
`ServerInstance.getList()` and fall back to sending `/list` and polling the log
tail for servers without RCON.

## Stats

Minecraft writes one JSON file per player, in one of two historical shapes.
`flattenStats()` normalizes both into `{ fullKey, category, key, value }[]`, and
everything downstream works on that. `filterStats()` is the fuzzy matcher behind
the `stat:` option — category matches first, then individual stat names.

`loadAllStats()` reads every player's file for a server and caches the bundle for
30 s. Invalidate it (`invalidateAllStatsCache`) after anything that writes stats.

## Leaderboards

`buildLeaderboard(statKey, opts)` is shared by `/leaderboard`, `/top`, and the
scheduled poster. It returns plain data; the caller renders it. Pass a
`baseline` and it subtracts, which is how a period board shows gains rather than
all-time totals.

A leaderboard is a read. It never deletes player data — UUIDs that neither the
whitelist nor the usercache can name are skipped, and cleaning up departed
players is an explicit admin action (`/server prune-stats`).

Streak boards (`streakLeaderboard.ts`) are keyed by Discord user rather than
player UUID, which is why they sit beside `LEADERBOARD_STATS` instead of inside
it. Period baselines do not apply to them — a streak *is* its own running total.

### Adding a leaderboard stat

Add an entry to `LEADERBOARD_STATS` in `statUtils.ts`:

```ts
crafted: {
  label: "Items Crafted",
  extract: (flat) =>
    flat.filter((s) => s.category === "minecraft:crafted")
        .reduce((sum, s) => sum + s.value, 0),
  format: (v) => v.toLocaleString(),
  sortAscending: false,
},
```

`/leaderboard` and `/top` pick it up automatically — their choice lists are
generated from this map — and hourly snapshots start recording it, so period
boards work after one snapshot cycle. Nothing else to wire.

## Snapshots

`snapshotUtils.ts` owns the `snapshots` table: an hourly full stat snapshot per
server, which is what lets a "daily" board show one day of gains and `/stats
daily` diff against 24 hours ago. Format, readers, and the retention policy are
in [data-storage.md](data-storage.md#snapshots) — read the retention section
before changing anything there, because retention and the readers are one
contract and it has been broken before.

## Upstream lookups

`mojang.ts` and `modUtils.ts` (Modrinth) are the two third-party HTTP calls.
Both follow the same shape: a fetch behind an explicit timeout, and a separate
pure function that narrows the response to a domain type. Callers get a
validated value or `null` — a changed upstream shape fails at the boundary, not
somewhere deep inside a command. A hung third party must never stall a command
or the poll loop, so the timeout is not optional.

`slimeChunk.ts` and `chunkbaseUrl.ts` are pure math and URL building, no I/O.
The Java LCG constants in `slimeChunk.ts` look like magic numbers and are not —
they are the Minecraft algorithm, named and documented in place.
