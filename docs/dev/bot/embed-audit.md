# Embed audit

Where each embed stands after the category refactor. Colour rule: status roles
for state, categories for everything else (see [replies.md](replies.md)).

| Feature | Files | Category | State |
|---|---|---|---|
| Daily claim, cooldown, queued | `commands/connection/daily/dailyEmbeds.ts` | reward (+ rarity) | Redesigned: head, rarity badge, streak bar, milestone |
| Streak, history, reminder DM | `daily/streak.ts`, `dailyHistory.ts`, `dailyReminderScheduler.ts` | reward | Bar and track, flame icons, DM is an embed |
| Streak and stat leaderboards | `utils/embeds/statEmbeds.ts` | leaderboard | Leader head as thumbnail |
| Joins and leaves | `watchers/log/joinLeave.ts` | presence | Own colour, 📥 / 📤 |
| Deaths | `watchers/log/deaths.ts` | death | Own colour, 💀 |
| Advancements, challenges | `watchers/log/advancements.ts` | advancement, milestone | Challenges are gold |
| Milestones | `watchers/monitors/milestoneWatcher.ts` | milestone | Gold |
| Chat bridge | `watchers/log/chatBridge.ts` | chat | Own colour |
| Restart schedule | `schedulers/restartScheduler.ts` | server, recovery | Icons added |
| Whitelist prompt | `interactions/whitelistApplications.ts` | whitelist | Icon added |
| Confirmations | `utils/embeds/confirm.ts` | confirm | Pending colour kept via category |
| Appearance page | `src/web/frontend/src/views/AppearanceView.vue` | all | Colour picker, hex input, dark and light preview, contrast warning, saves `embedColors` through the config route |
| Errors | `utils/embeds/embedUtils.ts` `createErrorEmbed` | error | ⛔ title icon |

## Still on fixed status colours (state-driven, by design)

Server status and alert embeds (`statusEmbed`, `downtimeMonitor`,
`hostResourcesMonitor`, `tpsMonitor`, `serverStateDisplay`), `/server` progress
embeds, whitelist decisions, polls, notes, challenge admin views and generic
info answers. They carry state or are plain answers, so they keep `EmbedColor`.

## Enforced

`npm run lint` rejects a numeric colour literal in `color:` or `setColor(...)`, and a
`new EmbedBuilder()`, anywhere under `src/bot` except the two embed builders.

## Not done yet

- Item icon thumbnails for rewards.
