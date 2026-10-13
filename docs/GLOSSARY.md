# Glossary

Terms specific to this project that are easy to misread.

| Term | Meaning |
|---|---|
| Embed category | What a Discord message is about (`reward`, `death`, `presence`, ...). Gives the embed a title icon and a default colour. Defined in `src/schema/embedCategories.ts`; recolourable with `embedColors`. Not the same as a status role. |
| Status role | How something is doing (online, degraded, offline, ...). Shared by the dashboard chips and server-state embeds (`src/schema/status.ts`). |
| Rarity tier | Daily reward rarity (common to legendary), derived from an item's share of its pool's total weight by `rarityOf`. Not stored in `dailyRewards.json`. |
| Milestone | A streak day that carries a bonus (`streakBonuses` key). The streak bar fills toward the next one. |
| Bonus streak | The counter that cycles back to 1 after the last milestone; separate from the current streak, which only resets on a miss of more than 48 hours. |
| Operation slot | The one place per instance that stop, restart, rollback, backup, restore, mod writes, the upgrade and the prune take, in the wrapper (`operationSlot.ts`) and as a file lock in the setup suite (`acquire_operation_lock`). While it is held, another of them answers 423 (exit 75 in scripts) instead of racing it. Mod writes share it with each other. |
| Upgrade job | `update/upgrade.sh`: stop, archive backup, install, start and watch, with a fallback ladder (disable the mods without a build, then restore this job's own backup). Reports NDJSON progress; the wrapper relays it. |
| Prune plan | What a chunk scan would delete, stored under `common/prune/<id>.plan.json` with a map per dimension. The id is a hash of the parameters and the deletions. Applying re-scans and deletes only what both scans agree on. |
| Lifecycle event | A line `start.sh` appends to `logs/lifecycle.ndjson`: `jvm_start`, `jvm_exit`, `restart_scheduled`, `crash_loop_gave_up`. Read through the wrapper's `GET /events` with a byte-offset cursor. |
| Kept on an old build | A mod with no build for the new Minecraft version that still loaded after an upgrade. It is reported as such, because it can misbehave in game. |
