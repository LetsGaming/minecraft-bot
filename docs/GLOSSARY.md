# Glossary

Terms specific to this project that are easy to misread.

| Term | Meaning |
|---|---|
| Embed category | What a Discord message is about (`reward`, `death`, `presence`, ...). Gives the embed a title icon and a default colour. Defined in `src/schema/embedCategories.ts`; recolourable with `embedColors`. Not the same as a status role. |
| Status role | How something is doing (online, degraded, offline, ...). Shared by the dashboard chips and server-state embeds (`src/schema/status.ts`). |
| Rarity tier | Daily reward rarity (common to legendary), derived from an item's share of its pool's total weight by `rarityOf`. Not stored in `dailyRewards.json`. |
| Milestone | A streak day that carries a bonus (`streakBonuses` key). The streak bar fills toward the next one. |
| Bonus streak | The counter that cycles back to 1 after the last milestone; separate from the current streak, which only resets on a miss of more than 48 hours. |
