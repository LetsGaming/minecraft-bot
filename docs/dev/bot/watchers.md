# Watchers and scheduled tasks

Background features live in `src/bot/logWatcher/watchers/`, grouped by what
starts them. All of them are wired once from `initMinecraftCommands.ts`, and
the entry point's name tells you which group a file belongs in:

| Directory | Starts on | Entry point |
|---|---|---|
| `log/` | a matching log line | `register*Watcher(logWatcher, …)` |
| `monitors/` | a timer, and alerts when a condition holds | `start*Monitor(client, …)` |
| `schedulers/` | a timer, and does the thing | `start*` / `reconcile*` |

`notifyGuilds.ts`, `watchFirer.ts`, `poller.ts`, `sendQueue.ts` and
`discordErrors.ts` sit at the root: all are called from more than one group and
owned by none.

## Log watchers

Subscribe a regex to a per-server log watcher:

```ts
// src/bot/logWatcher/watchers/log/villagerDeaths.ts
import { type Client } from "discord.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { log } from "@mcbot/core/utils/logger.js";
import type { ILogWatcher } from "../../logWatcher.js";
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

**Type it against `ILogWatcher`.** Every server is watched through
`RemoteLogWatcher`, an SSE stream from the wrapper. Watcher code depends on the
interface, not the class, so it never branches on how lines arrive and tests can
substitute a stub.

Conventions:

- A handler that throws only kills its own invocation; the watcher logs and
  continues. Still catch Discord API errors yourself, so one unreachable channel
  does not spam the error log.
- Anchor regexes on the log prefix (`serverEventRegex` for server-emitted events,
  `chatLineRegex` for chat) so player chat quoting a system message cannot
  trigger you.
- Player-name captures use `PLAYER_NAME` from `core/utils/sanitize.ts` (next to
  `isValidMcName`), not `\w+`, so Bedrock players with a `.` prefix are matched.
- Handlers run one at a time per server, so a handler must not wait on Discord or
  on several server round trips. Queue sends (`broadcastNotification` and
  `sendToGuildChannels` do) and run any other tail work with `runDetached`
  from `sendQueue.ts`; both log failures instead of throwing.
- A module that keeps per-server state registers `onServerRemoved(...)` from
  `logWatcher/serverCleanup.ts` at load, so a removed and re-added server id
  starts clean.

### Relay between bridges

The chat bridge (`logWatcher/watchers/log/chatBridge.ts`) binds one Discord channel to one server in both directions (and, in a relay group, forwards Discord chat to the group's other bridges). `setupDiscordToMc` handles every Discord message in a bridged channel. After the existing guards (bots and webhooks ignored, per-author limiter) it asks `planRelay` (`relay/relayBridge.ts`) whether the channel's bridge has a `relayGroup` and who else is in it: same group, same server, other channels, one entry per channel. When there is a plan:

1. The speaker's name comes from `relayName` (linked Minecraft name, else censored name plus tag). The same name is used for the in-game `tellraw` prefix.
2. The Minecraft side is delivered first, as before.
3. Opted-out users (`relayOptOutStore`) and blocklisted users (`bridgeBlocklist`) stop here with a 🚫 reaction. A group rate limit (`relayLimiter`, `limits.relay*`) drops the relay with a ⏳ reaction.
4. `relayMessage` runs the text through `transformRelayContent` and sends one copy per target through `enqueueSend`, so order per channel holds. The copy goes out through the target's webhook as `Name [Label]` with no avatar, or as an embed when the webhook is unusable (`postLine`, shared with the Minecraft-to-Discord path).
5. The copy ids go into `RelaySyncMap`. `messageUpdate` and `messageDelete` listeners (`setupRelaySync`) re-run the transform on edit and remove the copies on delete while the window is open.

A relayed copy is a bot or webhook message, which the first guard of the listener ignores, so relays never chain. `ensureRelayNotices` (`interactions/relayNotice.ts`) posts, edits and removes the pinned notices at startup and on every config reload. Design and file map: [../cross-server-relay.md](../cross-server-relay.md).

## Notifications

Anything that announces an event to a guild goes through
`broadcastNotification()` in `notifyGuilds.ts`. It is the single dispatch point,
and it filters each event against the guild's `notifications.events` list.

Alerts that go to another guild channel (downtime, TPS, disk, console relay) use
`sendToGuildChannels()` from the same file: the caller names the guild config
block (`pick`), a message factory built inside each guild's locale, and an
optional mention policy. It applies the server scope, fetches the channel
(`fetchSendable`) and sends through a per-channel ordered queue
(`sendQueue.ts`), so one slow channel delays only itself. A feature that needs
the sent message back (the upgrade monitor edits its post) uses `guildTargets()`
for the same selection and sends itself.

The event keys are a shared contract (`@mcbot/schema/notifications.js`), not a
loose string. Adding a broadcastable event means adding its key there once; the
dispatcher, the setup wizard, the validator, and the generated config schema
then all agree on the name. A guild with a channel but no `events` list gets
`DEFAULT_NOTIFICATION_EVENTS` — the absent-list case has to have a default,
because the version that dropped every event when the list was unset made the
feature silently dead for every guild the setup wizard had configured.

## Scheduled tasks

Export a `startX(client, guildConfigs)` that runs its work through
`startPoller(name, fn, ms)` from `poller.ts`, returns the `{ stop }` handle, and is
called once from `initMinecraftCommands.ts`. The poller arms the next tick only
after the previous one settled, so ticks never overlap, and a tick that throws is
logged instead of ending the loop. Pass a function as the interval to pick it
fresh from the live config before each tick.

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
