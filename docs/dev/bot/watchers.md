# Watchers and scheduled tasks

Background features live in `src/bot/logWatcher/watchers/`, grouped by what
starts them. All of them are wired once from `initMinecraftCommands.ts`, and
the entry point's name tells you which group a file belongs in:

| Directory | Starts on | Entry point |
|---|---|---|
| `log/` | a matching log line | `register*Watcher(logWatcher, …)` |
| `monitors/` | a timer, and alerts when a condition holds | `start*Monitor(client, …)` |
| `schedulers/` | a timer, and does the thing | `start*` / `reconcile*` |

`notifyGuilds.ts` and `watchFirer.ts` sit at the root: both are called from more
than one group and owned by none.

## Log watchers

Subscribe a regex to a per-server log watcher:

```ts
// src/bot/logWatcher/watchers/log/villagerDeaths.ts
import { type Client } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";

const REGEX = /\[.+?\].*:\s+Villager .+ died/;

export function registerVillagerDeathWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  logWatcher.register(REGEX, async (match) => {
    // build embed, fetch channel, send; always try/catch the Discord call
  });
}
```

Then wire it in `initMinecraftCommands.ts`, next to the existing `register*`
calls inside the per-server loop.

**Type it against `ILogWatcher`.** Local servers use file tailing, remote ones an
SSE stream from the wrapper; the interface is identical, so watcher code never
branches on local/remote — and the moment one does, remote servers have a silent
gap.

Conventions:

- A handler that throws only kills its own invocation; the watcher logs and
  continues. Still catch Discord API errors yourself, so one unreachable channel
  does not spam the error log.
- Anchor regexes on the log prefix (`/\[.+?\].*:\s+/`) so player chat quoting a
  system message cannot trigger you.
- Player-name captures use `[\w.]+`, not `\w+`, so Bedrock players with a `.`
  prefix are matched. `notifyGuilds.ts` holds the canonical `PLAYER_NAME` regex —
  use it rather than adding another copy.

## Notifications

Anything that announces an event to a guild goes through
`broadcastNotification()` in `notifyGuilds.ts`. It is the single dispatch point,
and it filters each event against the guild's `notifications.events` list.

The event keys are a shared contract (`@mcbot/schema/notifications.js`), not a
loose string. Adding a broadcastable event means adding its key there once; the
dispatcher, the setup wizard, the validator, and the generated config schema
then all agree on the name. A guild with a channel but no `events` list gets
`DEFAULT_NOTIFICATION_EVENTS` — the absent-list case has to have a default,
because the version that dropped every event when the list was unset made the
feature silently dead for every guild the setup wizard had configured.

## Scheduled tasks

Export a `startX(client, guildConfigs)` that sets up its own
`setInterval`/`setTimeout`, returns the timer, and is called once from
`initMinecraftCommands.ts`.

For anything that must run at a wall-clock time, use `nextMidnightEpoch()` /
`nextTimeOfDayEpoch()` from `core/utils/time.ts` and reschedule after each run
(`channelPurge.ts` is the example). A fixed 24h interval drifts across DST.

Tick-based schedulers resolve their instances via `getAllInstances()` each cycle
rather than capturing the list at startup — that is what lets a config reload add
a server without restarting the timer.

Durations that another layer also has to know are contracts, not constants. The
leaderboard intervals live in `@mcbot/schema/stats.js` because the snapshot
retention policy has to outlive the longest one; see
[core/data-storage.md](../core/data-storage.md#retention).
