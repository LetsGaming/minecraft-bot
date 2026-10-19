# Glossary

Terms specific to this project that are easy to misread.

| Term | Meaning |
|---|---|
| Embed category | What a Discord message is about (`reward`, `death`, `presence`, ...). Gives the embed a title icon and a default colour. Defined in `src/schema/embedCategories.ts`; recolourable with `embedColors`. Not the same as a status role. |
| Status role | How something is doing (online, degraded, offline, ...). Shared by the dashboard chips and server-state embeds (`src/schema/status.ts`). |
| Rarity tier | Daily reward rarity (common to legendary), derived from an item's share of its pool's total weight by `rarityOf`. Not stored in `dailyRewards.json`. |
| Milestone | A streak day that carries a bonus (`streakBonuses` key). The streak bar fills toward the next one. |
| Bonus streak | The counter that cycles back to 1 after the last milestone; separate from the current streak, which only resets on a miss of more than 48 hours. |
| Claim outcome | The tagged result of one `/daily` attempt (`claimed`, `queued`, `cooldown`, `queue-full`, ...) returned by `claimDaily` in `core/utils/minecraft/dailyClaim.ts`. The command only turns it into a reply. A `queued` outcome covers both an offline claim and the items an online delivery could not hand over. |
| Operation slot | The one place per instance that stop, restart, rollback, backup, restore, mod writes, the upgrade and the prune take, in the wrapper (`operationSlot.ts`) and as a file lock in the setup suite (`acquire_operation_lock`). While it is held, another of them answers 423 (exit 75 in scripts) instead of racing it. Mod writes share it with each other. |
| Upgrade job | `update/upgrade.sh`: stop, archive backup, install, start and watch, with a fallback ladder (disable the mods without a build, then restore this job's own backup). Reports NDJSON progress; the wrapper relays it. |
| Prune plan | What a chunk scan would delete, stored under `common/prune/<id>.plan.json` with a map per dimension. The id is a hash of the parameters and the deletions. Applying re-scans and deletes only what both scans agree on. |
| Lifecycle event | A line `start.sh` appends to `logs/lifecycle.ndjson`: `jvm_start`, `jvm_exit`, `restart_scheduled`, `crash_loop_gave_up`. Read through the wrapper's `GET /events` with a byte-offset cursor. |
| Kept on an old build | A mod with no build for the new Minecraft version that still loaded after an upgrade. It is reported as such, because it can misbehave in game. |
| Record cache | The setup suite's per-region copy of what a scan reads (state, `InhabitedTime`, sector size per chunk) under `common/prune/cache/`, valid while the region file's size, mtime and header digest match. Parameters never enter it, so changing a threshold or zone reads no file. |
| Manual selection | Chunks chosen by hand in the prune map: an ordered list of add/remove rectangles sent as `selection` with the scan parameters. It overrides soft rules (in use, buffer), and hard protections only with `allowProtected`. Unreadable chunks are never deleted. Not saved as a default. |
| Soft rule / hard protection | Soft: a chunk is in use or inside the buffer; a manual selection may override it. Hard: spawn, player areas and drawn zones; held unless `allowProtected`. |
| Service user | The unprivileged Linux user the API wrapper runs as when `API_SERVER.SERVICE_USER` is set (`service_user.sh`): ACL grants on the instance files and a generated sudoers file naming exact scripts. |
| Relay group | A name set as `relayGroup` on chat bridges. Bridges with the same group and the same Minecraft server relay Discord messages to each other. Never spans Minecraft servers. Planned, see `docs/dev/cross-server-relay.md`. |
| Source label | The short guild name shown next to a relayed sender, set by the guild's admin. It tells readers which Discord server a message came from. |
| Relay identity | The name shown for a relayed Discord user: the linked Minecraft name, otherwise a censored Discord display name. Never an avatar or a Discord id. |
| Terrain tile | A 512 x 512 PNG of one region seen from above, drawn by the setup suite (`prune-chunks.js --tile`) and cached under `common/prune/tiles/` by the region file's fingerprint. Shown under the prune map's classes in the Terrain view. |
| Dispatch queue | The one-at-a-time queue a server's log watcher runs its handlers on (`RemoteLogWatcher`). A handler that waits on Discord or the server holds up every other watcher for that server, so handlers queue their sends and run tail work detached (`watchers/sendQueue.ts`). |
| Send queue | A per-Discord-channel ordered queue (`watchers/sendQueue.ts`): sends to one channel keep their order, and a slow channel delays only itself. |
| Poller | `startPoller` in `watchers/poller.ts`: a self re-arming timer that arms the next tick only after the previous one settled, logs a failed tick, and returns `{ stop }`. |
| Wrapper fetch | `wrapperFetch` in `core/utils/server/access/apiClient.ts`: the one place a wrapper request is made. It adds the API key, applies the timeout, counts the circuit breaker (a 502 does not count) and turns a 429 into `RateLimitedError`. Every `api*` helper is a thin layer over it. |
| Latest-wins loader | `useLoader` in the dashboard (`composables/useLoader.ts`): a fetch wrapper with a generation guard, so a response that arrives after a newer request was started is dropped instead of overwriting newer state. |
| Typed store | A module in `core/utils/stores/` that owns one `kv` key and its JSON shape, with typed load and update functions (`kvMutate` underneath). Callers never touch the key, and whole-document saves are not exported. |
| Gone quiet | A player who is not online and was last seen at least N days ago (Players page and Analytics, `status=quiet`). Needs a recorded session end, so a player with only an open session or only sessions older than the 365 day retention never appears. |
| Retained sessions | The `player_sessions` rows still kept: one per join, closed ones pruned after 365 days (`ANALYTICS_RETENTION_DAYS.sessions`). Playtime, first seen and session counts are computed from them, so they cover that window and not the whole life of a player. |
