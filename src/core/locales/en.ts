/**
 * English locale (default + fallback).
 *
 * Key convention: `<area>.<message>` in camelCase. Placeholders use
 * {curlyBraces} and are substituted by t() — see utils/i18n.ts.
 *
 * Every user-visible string goes through t(); `npm run i18n:check` rejects
 * hard-coded literals in the Discord layer and any key missing from de.ts.
 */
export const en: Record<string, string> = {
  // ── info (how to join) ──
  "info.title": "How to join — {server}",
  "info.address": "Address",
  "info.addressUnset": "Not published. Ask an admin for the join address.",
  "info.version": "Minecraft version",
  "info.versionUnknown": "Unknown — the server did not answer.",
  "info.loader": "Loader",
  "info.loaderUnknown": "Not reported",
  "info.modpack": "Modpack",
  "info.required": "Required mods",
  "info.requiredCount": "{count} mod(s) must be installed on the client. See `/mods` for the list.",
  "info.requiredUnknown": "Could not read the mod list right now.",
  "info.vanillaJoin": "None — a vanilla client can join.",

  // ── common ──
  "common.serverNotFound": "Server not found.",
  "common.noPermission": "You do not have permission to use this command.",
  "common.invalidUsername": "**{username}** is not a valid Minecraft username.",

  // ── whois ──
  "whois.title": "Whois — {username}",
  "whois.noData": "No whitelist or link data found for **{username}**.",
  "whois.addedBy": "Added by",
  "whois.addedAt": "Added at",
  "whois.server": "Server",
  "whois.uuid": "UUID",
  "whois.removedBy": "Removed by",
  "whois.removedAt": "Removed at",
  "whois.linkedAccount": "Linked Discord account",
  "whois.notLinked": "Not linked",

  // ── daily reminders ──
  "dailyReminder.enabled":
    "✅ Daily reminders enabled — I'll DM you when your next /daily is ready. Make sure your DMs are open for this server.",
  "dailyReminder.disabled": "✅ Daily reminders disabled.",
  "dailyReminder.dm":
    "🎁 Your daily reward is ready! Claim it with /daily on the server.",
  "dailyReminder.dmServer":
    "🎁 Your daily reward on **{server}** is ready! Claim it with /daily server:{server}.",

  // ── live server queries ──
  "query.unreachable":
    "Could not reach the server right now. Try again in a moment.",
  "query.noDimension":
    "Could not tell which dimension you are in. Try again in a moment.",
  "seed.unavailable": "Could not retrieve the world seed.",
  "netherportal.noPosition": "Could not get your position.",

  // ── slime (!slime) ──
  "slime.noSeed": "Could not retrieve the world seed.",
  "slime.noPosition": "Could not get your position. Try again in a moment.",
  "slime.wrongDimension": "Slime chunks only exist in the Overworld.",
  "slime.yes": "Chunk [{cx}, {cz}] IS a slime chunk! 🟢",
  "slime.no": "Chunk [{cx}, {cz}] is not a slime chunk.",

  // ── death position (!deathpos + watcher DM) ──
  "deathpos.none":
    "No recorded death found — you may not have died yet on this world.",
  "deathpos.result": "☠ Your last death: {x} / {y} / {z} ({dimension})",
  "deathpos.dm":
    "☠ You died on **{server}** at **{x} / {y} / {z}** ({dimension}). Grab your stuff before it despawns!",

  // ── waypoints ──
  "waypoint.usage":
    "Usage: !waypoint <name> — look up | !waypoint set <name> — save | !waypoint del <name> — delete yours",
  "waypoint.invalidName":
    "Waypoint names may only contain letters, numbers, _ or - (max 24 characters).",
  "waypoint.noPosition": "Could not get your position. Try again in a moment.",
  "waypoint.taken": 'Waypoint "{name}" belongs to {author} — only they can change it.',
  "waypoint.limitReached": "This server already has {max} waypoints.",
  "waypoint.saved": '📍 Saved waypoint "{name}" at {x} / {y} / {z}.',
  "waypoint.deleted": 'Deleted waypoint "{name}".',
  "waypoint.deletedByAdmin": 'Deleted waypoint "{name}" (created by {author}).',
  "waypoint.notFound": 'No waypoint named "{name}". Use !waypoints to list all.',
  "waypoint.result": "📍 {name}: {x} / {y} / {z} ({dimension}) — set by {author}",
  "waypoint.noneInGame": "No waypoints yet. Create one with: !waypoint set <name>",
  "waypoint.listHeader": "📍 Waypoints on this server ({count}):",
  "waypoint.listMore": "…and {more} more — see /waypoints on Discord.",
  "waypoint.embedTitle": "📍 Waypoints — {server}",
  "waypoint.embedFooter": "Page {page}/{pages} • {count} waypoints",
  "waypoint.embedEntry": "`{x} / {y} / {z}` ({dimension}) — by **{author}**, {date}",
  "waypoint.noneDiscord":
    "No waypoints yet. Players can create them in-game with `!waypoint set <name>`.",

  // ── reports (!report) ──
  "report.usage": "Usage: !report <message>",
  "report.embedTitle": "🚨 Report from {player}",
  "report.sent": "✅ Your report has been sent to the admins. Thank you!",
  "report.noChannel":
    "Reports are not set up for this server yet — please contact an admin directly.",

  // ── daily delivery queue ──
  "daily.queueFull":
    "You already have {max} unclaimed rewards waiting in-game. Join the server to collect them before claiming again.",
  "daily.queued":
    "📦 You're offline on **{server}** right now — your reward is queued and will be delivered the next time you join. Your streak is safe!",
  "daily.delivered": "📦 Delivered {count} queued daily reward item(s). Enjoy!",

  // ── sessions ──
  "sessions.none": "No session data recorded for **{player}** on **{server}** yet.",
  "sessions.onlineNow": "🟢 Online right now",
  "sessions.lastSeen": "Last seen {when}",
  "sessions.lastSeenUnknown": "Last seen: unknown",
  "sessions.title": "Sessions — {player} @ {server}",
  "sessions.playtime": "Recent playtime",
  "sessions.playtimeValue": "{duration} across the last {count} session(s)",
  "sessions.recent": "Last {count} session(s)",
  "sessions.stillOnline": "still online",
  "players.title": "Players on {server}",
  "players.footer": "Page {page}/{pages} • {count} players",
  "players.online": "online now",
  "players.beforeTracking": "before tracking",
  "players.none": "No players found on this server yet.",
  "players.noneInactive": "No players have been inactive for more than {days} day(s).",

  // ── whois additions ──
  "whois.lastSeen": "Last seen",
  "whois.onlineNow": "🟢 Online right now on **{server}**",
  "whois.lastSeenValue": "{when} on **{server}**",
  "whois.notes": "Admin notes",
  "whois.moreNotes": "…and {more} more — see /note list.",

  // ── admin notes (/note) ──
  "note.unknownPlayer":
    "**{player}** is not known to this server (not in whitelist or user cache).",
  "note.emptyText": "Note text must not be empty.",
  "note.addedTitle": "Note added",
  "note.added": "Note saved for **{player}**.",
  "note.removedTitle": "Note removed",
  "note.removed": "Removed note #{index} for **{player}**.",
  "note.badIndex": "No note with that number for **{player}** — check /note list.",
  "note.none": "No notes for **{player}**.",
  "note.listTitle": "Notes — {player}",
  "note.listFooter": "{count}/{max} notes",

  // ── challenges ──
  "challenge.alreadyActive":
    'A challenge is already running: **{advancement}**. Cancel it first or wait for a winner.',
  "challenge.noneActive": "No active challenge on **{server}**.",
  "challenge.noneYet": "No challenges have been run on **{server}** yet.",
  "challenge.statusTitle": "🏆 Challenge — {status}",
  "challenge.status.active": "active",
  "challenge.status.won": "won",
  "challenge.status.expired": "expired",
  "challenge.status.cancelled": "cancelled",
  "challenge.fieldAdvancement": "First to earn: **{advancement}**",
  "challenge.fieldItem": "Item bonus: {amount}× {item}",
  "challenge.fieldStartedBy": "Started by {by} {when}",
  "challenge.fieldEnds": "Ends {when}",
  "challenge.fieldWonBy": "Won by **{player}** 🎉",
  "challenge.rewardLine": "🎁 Reward: {reward}",
  "challenge.startedTitle": "🏆 New challenge!",
  "challenge.startedEmbed": "First player to earn **{advancement}** wins!",
  "challenge.startedInGame":
    "🏆 New challenge: first player to earn \"{advancement}\" wins!",
  "challenge.wonTitle": "🏆 Challenge won!",
  "challenge.wonEmbed": "**{player}** was first to earn **{advancement}**!",
  "challenge.wonInGame": "🏆 {player} won the challenge: \"{advancement}\"!",
  "challenge.cancelledTitle": "Challenge cancelled",
  "challenge.cancelled": "Cancelled the challenge **{advancement}**.",

  // ── polls ──
  "poll.alreadyActive":
    'A poll is already open: "{question}". Close it before starting a new one.',
  "poll.noneActive": "No open poll on **{server}**.",
  "poll.noneInGame": "There is no open poll right now.",
  "poll.needChannel": "Polls must be created in a text channel.",
  "poll.badOptions": "Please provide {min}–{max} options separated by |.",
  "poll.howToVote": "Vote with the buttons below or in-game with `!vote <number>`.",
  "poll.ends": "Ends",
  "poll.voted": '✅ Vote recorded: "{option}"',
  "poll.badVote": "Please vote with a number between 1 and {max}.",
  "poll.voteHint": "Vote with: !vote <number>",
  "poll.announceInGame": '🗳️ New poll: "{question}"',
  "poll.closedReply": "This poll is already closed.",
  "poll.closedTitle": "Poll closed",
  "poll.closed": 'Closed the poll "{question}" and announced the results.',
  "poll.resultTitle": "🗳️ Poll results",
  "poll.resultTotal": "{total} vote(s) total",
  "poll.resultInGame": '🗳️ Poll results: "{question}"',

  // ── host resources ──
  "status.hostTitle": "Host",
  "status.hostMachine": "Machine: {ram} / {ramTotal} RAM, {cpu}% CPU ({cores} cores)",
  "status.hostProcess": "Server process: {ram} RAM, {cpu}% CPU",
  "status.hostFilesystem": "{mount} — {percent}% used, {free} free of {total}",
  "status.hostDir": "\u00a0\u00a0`{path}`: {size}",
  "status.hostDirUnknown": "\u00a0\u00a0`{path}`: size unavailable",
  "hostAlerts.diskFullTitle": "⚠️ Disk space warning",
  "hostAlerts.diskFull":
    "**{server}**: `{path}` is at **{percent}%** disk usage ({free} free). Backups and world saves may start failing.",
  "hostAlerts.diskOkTitle": "✅ Disk space recovered",
  "hostAlerts.diskOk": "**{server}**: `{path}` is back down to {percent}% disk usage.",

  // ── downtime + TPS alerts ──
  "downtime.upTitle": "✅ Server Back Online",
  "downtime.up": "**{server}** is back online.",
  "downtime.downTitle": "🔴 Server Down",
  "downtime.down":
    "**{server}** appears to be offline.\nFailed {failures} consecutive checks.",
  "downtime.apiDownTitle": "🟠 Server API Unreachable",
  "downtime.apiDown":
    "The API wrapper for **{server}** has not answered for {failures} checks.\nThe Minecraft server itself may well still be running — its state is currently **unknown**, not offline.",
  "downtime.apiUpTitle": "✅ Server API Reachable",
  "downtime.apiUp": "The API wrapper for **{server}** is answering again.",
  "downtime.apiDownServerKnown":
    "The Minecraft server itself answered a direct ping and is **{state}** — players are unaffected, but server controls, the chat bridge and stats are down until the wrapper is back.",
  "downtime.apiDownServerUnknown":
    "The Minecraft server did not answer a direct ping either, so its state is **unknown** — it may or may not still be running.",
  "downtime.crashLoopTitle": "🔁 Server Crash Loop",
  "downtime.crashLoop":
    "**{server}** has restarted {restarts} times and systemd has given up retrying — it will stay down until someone intervenes.\nCheck the logs for what's causing the crash (a broken mod is the usual suspect — try `/mods` disable on anything recently changed), then use **/server restart** to bring it back; that also clears systemd's failure state.",
  "downtime.crashLoopRecoveredTitle": "✅ Crash Loop Cleared",
  "downtime.crashLoopRecovered": "**{server}** is no longer in a crash loop.",
  "state.online": "Online",
  "state.unresponsive": "Not responding",
  "state.offline": "Offline",
  "state.unknown": "State unknown",
  "state.unresponsiveHint":
    "The server process is running but is not answering commands — it may be starting up or under heavy load.",
  "state.unknownHint":
    "Neither the server's API wrapper nor the server itself answered, so its state could not be determined. Check that the host is reachable.",
  "state.wrapperDownHint":
    "The server itself is reachable, but its API wrapper is not — so server controls, the chat bridge, stats and log watching are unavailable until it is back.",
  "state.viaPing": "via direct server ping",
  "tps.lowTitle": "⚠️ Low TPS Warning",
  "tps.low": "Server TPS has dropped below {threshold}",

  // ── /daily-admin ──
  "dailyAdmin.unknownServer":
    'Unknown server "{server}". Configured servers: {servers}',
  "dailyAdmin.samServer": "Source and target server are the same.",
  "dailyAdmin.noRecord": "**{user}** has no claim record on **{server}**.",
  "dailyAdmin.targetExists":
    "**{user}** already has a record on **{server}** — pass overwrite:true to replace it.",
  "dailyAdmin.moved": "Moved **{user}**'s daily record from **{from}** to **{to}**.",
  "dailyAdmin.reset": "Reset **{user}**'s daily record on **{server}**.",
  "dailyAdmin.showTitle": "Daily records — {user}",
  "dailyAdmin.showLine":
    "**{server}**: streak {streak} (longest {longest}), last claim {last}",
  "dailyAdmin.showNone": "No claim records on any server.",

  "control.progressLong":
    "This can take several minutes (countdown, world save and, for backups, archiving)...",
  "control.stillRunning":
    "**{action}** on **{server}** is taking longer than the bot waits for. The script may still be running. Check with `/server status` before running it again.",

  // ── waypoint categories ──
  "waypoint.invalidCategory":
    "Categories may only contain letters, numbers, _ or - (max 16 characters).",
  "waypoint.noneInCategory": 'No waypoints in category "{category}".',

  // ── span polls ──
  "poll.alreadyActiveOn":
    'Server **{server}** already has an open poll: "{question}". Close it first, or leave that server out of the span.',

  // ── backup staleness ──
  "backupAlert.staleTitle": "⚠️ Backups are getting stale",
  "backupAlert.stale":
    "**{server}**: the newest backup is **{age}h** old (threshold {max}h). Check the backup job before you need it.",
  "backupAlert.freshTitle": "✅ Fresh backup detected",
  "backupAlert.fresh": "**{server}**: a new backup appeared ({age}h old).",

  // ── moderation shortcuts ──
  "moderation.kicked": "Kicked **{player}** from **{server}**.",
  "moderation.banned": "Banned **{player}** on **{server}**.",
  "moderation.pardoned": "Unbanned **{player}** on **{server}**.",
  "moderation.bannedTemp":
    "Banned **{player}** on **{server}** for **{duration}** — until {until}.",
  "tempban.dmExpired":
    "Your temporary ban on **{server}** has expired — **{player}** can join again. Please keep to the rules.",
  "moderation.invalidDuration":
    "`{input}` is not a valid duration. Use e.g. `30m`, `2h`, `3d`, `1w`, `2mo`, `1.5y` (max 10y).",

  // ── /activity ──
  "activity.title": "📈 Activity — {server}",
  "activity.noData":
    "No player-count history for **{server}** yet — samples accrue while the bot runs.",
  "activity.last24h": "Average players, last 24h (oldest → newest):",
  "activity.peak": "Peak in that window: **{peak}**",
  "activity.busiest": "Busiest hours ({tz}, 14-day average):",
  "activity.busyLine": "**{hour}:00–{next}:00** — {avg} players on average",
  "activity.noBusyData": "Not enough data yet.",

  // ── /console ──
  "console.tailTitle": "last {lines} log line(s)",
  "console.emptyLog": "(log is empty)",
  "console.guildOnly": "The live relay is per Discord server — use this inside one.",
  "console.noChannel":
    'No console channel configured for this guild. Set guilds.<id>.console.channelId in config.json first.',
  "console.liveEnabled":
    "Live console for **{server}** now relays into {channel} (batched every few seconds).",
  "console.liveDisabled": "Live console for **{server}** disabled.",

  // ── console command delivery ──
  "console.notDelivered":
    "The command did not reach **{server}** ({reason}). Nothing was changed.",
  "console.refused": "**{server}** refused the command: {output}",
  "console.unverified":
    "The command was sent, but this server has no reply channel, so the result is unverified.",
  "console.reason.wrapper-down": "the API wrapper is unreachable",
  "console.reason.timeout": "the API wrapper did not answer in time",
  "console.reason.breaker-open":
    "the API wrapper has been failing, so requests are paused briefly",
  "console.reason.rate-limited": "the API wrapper is rate limiting requests",
  "console.reason.http-error": "the API wrapper answered with an error",
  "console.reason.screen-failed": "the server console could not be written to",
  "console.reason.rejected": "the API wrapper rejected the command",

  // ── scheduled restarts ──
  "schedule.warnInGame": "Server restart in {minutes} minute(s)!",
  "schedule.warnTitle": "🔄 Scheduled restart ahead",
  "schedule.warn": "**{server}** restarts in **{minutes} min** (at {time}).",
  "schedule.doneTitle": "🔄 Scheduled restart executed",
  "schedule.done": "**{server}**: the scheduled restart was triggered.",

  // ── /daily-history ──
  "dailyHistory.title": "🗓️ Daily claims — {server}",
  "dailyHistory.none":
    "No claims recorded for you on **{server}** yet — `/daily` starts the history.",
  "dailyHistory.line": "{when} · streak {streak} — {items}",
  "dailyHistory.footer": "Showing {shown} of {total} stored claim(s)",

  // ── /profile ──
  "profile.title": "👤 {player}",
  "profile.noPlayer":
    "No player given and no linked account — pass player: or run /link first.",
  "profile.linked": "🔗 Linked to {mention}",
  "profile.notLinked": "🔗 Not linked to any Discord account",
  "profile.whitelisted": "📋 Whitelisted by {by} on {at}",
  "profile.playtime": "⏱️ {playtime} play time across {sessions} session(s)",
  "profile.onlineNow": "🟢 Online right now",
  "profile.lastSeen": "⚪ Last seen {when}",
  "profile.streak": "🔥 Daily streak: {current} (longest {longest})",
  "profile.nothingKnown": "Nothing on record for this player on this server yet.",

  // ── milestones ──
  "milestone.title": "🏅 Milestone reached!",
  "milestone.body": "**{player}** just passed **{value}** {stat}!",
  "milestone.inGame": "{player} just passed {value} {stat}!",

  // ── /watch ──
  "watch.listTitle": "👁️ Your watches",
  "watch.listNone": "No active watches. Try `/watch server` or `/watch player`.",
  "watch.listServer": "`{id}` — server **{server}** back online",
  "watch.listPlayer": "`{id}` — player **{player}** joins **{server}**",
  "watch.notFound": "No watch with ID `{id}` on your account.",
  "watch.removed": "Watch `{id}` removed.",
  "watch.limit": "You already have {max} watches — remove one first (/watch list).",
  "watch.duplicate": "You already have that exact watch armed.",
  "watch.serverArmed":
    "Armed: you'll get **one DM** when **{server}** is back online. Make sure your DMs are open.",
  "watch.playerArmed":
    "Armed: you'll get **one DM** when **{player}** joins **{server}**. Make sure your DMs are open.",
  "watch.dmServer": "✅ **{server}** is back online. (This watch is now used up.)",
  "watch.dmPlayer": "👋 **{player}** just joined **{server}**. (This watch is now used up.)",

  // ── whitelist applications ──
  "wlapp.promptTitle": "📋 Whitelist application",
  "wlapp.promptBody":
    "Want to play on the server? Hit the button, tell us your Minecraft name, and an admin will review it.",
  "wlapp.applyButton": "Apply for whitelist",
  "wlapp.modalTitle": "Whitelist application",
  "wlapp.modalName": "Your Minecraft username",
  "wlapp.modalNote": "Anything the admins should know? (optional)",
  "wlapp.invalidName": "**{name}** is not a valid Minecraft username.",
  "wlapp.noServer":
    "This guild has multiple servers and no default — an admin needs to set guilds.<id>.defaultServer before applications can route.",
  "wlapp.alreadyPending":
    "You already have a pending application — an admin will get to it.",
  "wlapp.queueBroken":
    "The application queue channel is unavailable — please tell an admin.",
  "wlapp.submitted":
    "Application for **{name}** on **{server}** submitted — you'll get a DM once it's decided (make sure DMs are open).",
  "wlapp.queueTitle": "📋 Whitelist application",
  "wlapp.queueApplicant": "Applicant: {mention} ({tag})",
  "wlapp.queueName": "Minecraft name: **{name}**",
  "wlapp.queueServer": "Server: **{server}**",
  "wlapp.queueNote": "Note: {note}",
  "wlapp.approveButton": "Approve",
  "wlapp.denyButton": "Deny",
  "wlapp.notAdmin": "Only server admins can decide applications.",
  "wlapp.stale": "This application was already decided (or no longer exists).",
  "wlapp.serverGone":
    "Server **{server}** is no longer configured — the application cannot be approved.",
  "wlapp.approveFailed": "Whitelisting failed: {error}",
  "wlapp.approvedBy": "✅ Approved by {by}",
  "wlapp.deniedBy": "⛔ Denied by {by}",
  "wlapp.dmApproved":
    "✅ Your whitelist application for **{name}** was approved — welcome to **{server}**!",
  "wlapp.dmDenied": "⛔ Your whitelist application for **{name}** was denied.",
  "wlapp.modalServer": "Which server?",

  // ── command policy ──
  "command.disabledHere": "`/{command}` is disabled here.",
  "command.adminOnlyInGame":
    "!{command} is admin-only on this server (your linked Discord account must be a bot admin).",
  "nudge.link":
    "Tip: link your Discord to unlock rewards and stats — run /link in Discord, then type !link <code> here in chat.",
  "nudge.daily":
    "Tip: you're linked! Run /daily in Discord once a day for a free reward — it lands in your inventory, even if you claim it while offline.",
  "nudge.lastTime":
    "(That's the last time I'll mention it.)",
  "hint.dailyReminder.label":
    "Remind me next time",
  "hint.dailyReminder.confirm":
    "Reminders on — I'll DM you when your next daily is ready. Turn them off any time with /daily-reminder.",
  "hint.noThanks":
    "No thanks",
  "hint.notYours":
    "That button belongs to someone else's reply.",
  "hint.failed":
    "Could not turn that on — please try the command directly.",
  "hint.watchServer.label":
    "Notify me when it's back",
  "hint.watchServer.confirm":
    "I'll DM you once the server is back online. Make sure your DMs are open — manage watches with /watch.",
  "hint.statsLeaderboard":
    "Tip: /leaderboard ranks everyone on the same stat, and /compare puts two players side by side.",
  "hint.playtimeActivity":
    "Tip: /activity shows when the server is actually busy, so you can catch other players online.",
  "hint.seedChunkbase":
    "Tip: /chunkbase opens this seed in a map viewer, and /slime finds slime chunks in it.",
  "help.newToYou":
    "✨ marks the {count} command(s) you have not tried yet — they are listed first.",
  "deathpos.hint":
    "Tip: type !deathpos in chat to get these coordinates again at any time.",
  "report.hint":
    "Tip: if that was unfair, type !report <what happened> in chat and the admins will see it.",

  // ── /clear-dm ──
  "clearDm.none": "No bot messages found to delete.",
  "clearDm.deleted": "Deleted **{count}** bot message(s) from this DM.",

  // ── embed helpers ──
  "embed.errorTitle": "❌ Error",
  "embed.successTitle": "✅ Success",
  "embed.infoTitle": "ℹ️ Info",
  "common.requestedBy": "Requested by {user}",

  // ── /config ──
  "config.sumServers": "Servers: {servers}",
  "config.sumGuilds": "Guilds: {count}",
  "config.sumAdmins": "Admins: {count}",
  "config.added": "+ Added (live): {list}",
  "config.removed": "- Removed (live): {list}",
  "config.rebuilt": "~ Rebuilt (live): {list}",
  "config.needsRestart": "⚠ Changed settings on existing server(s) require a restart: {list}",
  "config.moreChanges": "~ …and {count} more change(s)",
  "config.noChanges": "No changes detected.",
  "config.reloaded": "Config reloaded from disk.\n{details}",
  "config.featStatus": "status",
  "config.featNotifications": "notifications",
  "config.noFeatures": "no features configured",
  "config.title": "⚙️ Bot Configuration",
  "config.fieldClientId": "Client ID",
  "config.fieldServers": "Servers ({count})",
  "config.fieldGuild": "Guild",
  "config.fieldAdmins": "Admins",
  "config.fieldDisabled": "Disabled Commands",
  "config.fieldTpsThreshold": "TPS Threshold",
  "config.fieldTpsInterval": "TPS Poll Interval",
  "config.fieldLeaderboardInterval": "Leaderboard Interval",
  "config.none": "none",
  "config.footer": "Use /config reload to apply config.json changes",

  // ── /daily, /streak ──
  "daily.processing": "⏳ Already processing your claim, please wait.",
  "streak.noData": "No streak data found for your account.",
  "streak.noDataFooter": "Streak Data Not Found",
  "streak.days": "{count} days",
  "streak.na": "N/A",
  "streak.info": "📅 **Daily Streak Information**\n**Current Streak:** {current}\n**Longest Streak:** {longest}\n**Next Bonus Streak:** {next}",

  // ── /link, /unlink ──
  "link.pending": "⚠️ You already have a pending link code: `{code}`. Please use that code or wait for it to expire before generating a new one.",
  "link.alreadyLinked": "⚠️ You have already linked your account. If you want to link a different Minecraft account, please unlink first.",
  "link.instructions": "🧩 To link your Minecraft account, join the server and type:\n`!link {code}`\n(This code expires in 5 minutes)",
  "link.notLinked": "❌ Your Discord account is not linked to any Minecraft account.",
  "link.status": "✅ Your Discord account is linked to Minecraft account: `{account}`",
  "link.unlinked": "✅ Your Discord account has been successfully unlinked from your Minecraft account.",

  // ── /help, /map, /chunkbase, /seed ──
  "help.title": "📖 Command Help (Page {page}/{pages})",
  "help.description": "**Description:**\n{description}",
  "help.required": "**(required)**",
  "help.optional": "(optional)",
  "help.options": "Options",
  "map.notConfigured": "The map URL is not configured. Please contact the server administrator.",
  "map.title": "Live Minecraft Map",
  "map.description": "You can view the live Minecraft map [here]({url}).",
  "chunkbase.title": "Chunkbase Map",
  "chunkbase.open": "[Open Seed Map]({url})",
  "seed.title": "World Seed: {server}",

  // ── /mods, /status, /uptime ──
  "mods.title": "🧩 Installed Mods: {server}",
  "mods.count": "**{count}** mods installed",
  "mods.footerStale": "Last known list from {age}. The server is not answering right now.",
  "mods.footerFresh": "Data from Modrinth · last fetched {time}",
  "mods.groupBoth": "📦 Client + Server",
  "mods.groupOptional": "🔧 Optional (client)",
  "mods.groupServer": "🔒 Server-only",
  "status.title": "Server Status: {server}",
  "status.playersSuffix": ": {players}",
  "status.summary": "{emoji} **{label}**: {online}/{max} players",
  "status.botPing": "Bot Ping",
  "status.roundTrip": "Round Trip",
  "status.online": "Online",
  "uptime.overviewTitle": "📈 Server Uptime",
  "uptime.forDuration": " for {duration}",
  "uptime.currently": "{emoji} Currently **{state}**",
  "uptime.title": "📈 Uptime: {server}",
  "uptime.last24h": "Last 24 hours",
  "uptime.last7d": "Last 7 days",
  "uptime.last30d": "Last 30 days",
  "uptime.trend": "24h trend (hourly)",
  "uptime.trendLegend": "`{bar}` (oldest → now, · = no data)",
  "uptime.basedOn": "Based on {checks24h} checks (24h) · {checks7d} checks (7d)",
  "uptime.noData": "No uptime data collected yet. Stats fill in over time.",

  // ── /whitelisted ──
  "whitelisted.empty": "The whitelist is empty. It may be disabled on this server.",
  "whitelisted.title": "📃 Whitelisted Minecraft Players",
  "whitelisted.page": "Page {page}",
  "whitelisted.total": "Total: {count}",
  "whitelisted.readFailed": "Failed to read the Whitelist.",

  // ── shared command messages ──
  "common.rateLimited": "Too many commands. Please wait {seconds}s.",
  "common.unexpectedError": "An unexpected error occurred.",
  "common.unexpectedErrorRecovery": "Try again in a moment. If it keeps happening, tell an admin.",
  "common.playerNotFound": "Player `{player}` not found.",
  "common.playerNotFoundFooter": "Player Not Found",
  "pagination.notForYou": "These buttons aren't for you.",

  // ── /stats, /compare, /playtime ──
  "stats.pageTitle": "Stats for {name} (Page {page}/{pages})",
  "stats.pageFooter": "Total stats: {total} | Page {page}/{pages}",
  "stats.fileNotFound": "Stats file not found for `{player}`.",
  "stats.fileNotFoundFooter": "Stats File Not Found",
  "stats.noMatch": "No stats found matching `{filter}`.",
  "stats.noMatchFooter": "Stats Not Found",
  "stats.failed": "Failed to retrieve stats.",
  "stats.noSnapshot": "No baseline snapshot available yet. Try again later, once stats have been recorded for at least 24h.",
  "stats.noSnapshotFooter": "No Snapshot",
  "stats.noChangeFiltered": "No stats matching `{filter}` changed in the last 24h.",
  "stats.noChange": "No stat changes in the last 24h for `{player}`.",
  "stats.noActivityFooter": "No Activity",
  "stats.dailyLabel": "{player}: last {hours}h",
  "stats.dailyFailed": "Failed to retrieve daily stats.",
  "compare.notFound": "Could not find one or both players: `{player1}`, `{player2}`.",
  "compare.noStatsFile": "Stats file not found for one or both players: `{player1}`, `{player2}`.",
  "compare.noStats": "No stats found for `{player1}` and `{player2}`.",
  "compare.error": "❌ An error occurred while comparing players.",
  "compare.title": "Stat Comparison: {player1} vs {player2} (Page {page}/{pages})",
  "compare.footer": "Shared stats: {count} | Page {page}/{pages}",
  "playtime.statNotFound": "Playtime stat not found for `{player}`.",
  "playtime.statNotFoundFooter": "Playtime Stat Not Found",
  "playtime.title": "⏳ Playtime for {player}",
  "playtime.total": "Total playtime: **{time}**",
  "playtime.errorFooter": "Playtime Error",

  // ── /clear, /backup, /tps ──
  "clear.textChannelOnly": "This command can only be used in a text channel.",
  "clear.deleted": "Deleted **{count}** message(s).",
  "clear.tooOld": "_Messages older than 14 days cannot be bulk-deleted._",
  "backup.none": "No backups found.",
  "backup.title": "💾 Backup Status: {server}",
  "backup.summary": "Newest: {age} ago ({size} MB, {dir})\nTotal: {total} GB",
  "backup.entry": "{count} backup(s)\nLatest: {age} ago ({size} MB)",
  "tps.unsupported": "TPS monitoring requires RCON or an API wrapper.",
  "tps.unavailable": "Could not retrieve TPS. Server may be offline.",
  "tps.title": "{emoji} TPS: {server}",
  "tps.tickTiming": "Tick Timing",
  "tps.current": "Current TPS: **{value}**",

  // ── /server control, whitelist ──
  "control.verb.start": "Starting",
  "control.verb.stop": "Stopping",
  "control.verb.restart": "Restarting",
  "control.verb.backup": "Backing up",
  "control.verb.status": "Checking",
  "control.past.start": "started",
  "control.past.stop": "stopped",
  "control.past.restart": "restarted",
  "control.past.backup": "backup complete",
  "control.past.status": "status retrieved",
  "control.progressTitle": "{emoji} {verb}: {server}",
  "control.startRunning": "Executing start script...",
  "control.noOutput": "No output",
  "control.exitCode": "Exited with code {code}",
  "control.failed": "**{action}** failed on **{server}**",
  "control.done": "**{server}**: {past}",
  "control.pruneNoWhitelist": "Whitelist is empty or could not be loaded. Refusing to prune, since that would delete every player's stats.",
  "control.pruneNone": "No orphaned stats files on **{server}**, nothing to prune.",
  "control.pruneDryTitle": "🧹 Prune stats: dry run ({server})",
  "control.pruneDryBody": "{count} stats file(s) belong to players not on the whitelist:\n```\n{list}\n```\nRe-run with `confirm: true` to delete them permanently.",
  "control.pruned": "Deleted {count} orphaned stats file(s) on **{server}**.",
  "whitelist.notFound": "Username **{username}** not found.",
  "whitelist.added": "**{name}** has been whitelisted on **{server}**.",
  "whitelist.removed": "**{username}** has been removed from the whitelist on **{server}**.",

  // ── watcher embeds ──
  "advancement.challenge": "✨ Completed challenge",
  "advancement.made": "⭐ Made advancement",
  "death.title": "☠️ Death",
  "joinLeave.joinedTitle": "Player Joined",
  "joinLeave.leftTitle": "Player Left",
  "joinLeave.joined": "{player} joined the server",
  "joinLeave.left": "{player} left the server",
  "updateNotifier.message": "📦 minecraft-bot {latest} is available (you run {current}). Release notes: {url}",
  "leaderboard.streakFooter": "{server} · all-time streaks",
  "statusEmbed.title": "📊 Server Status",
  "statusEmbed.footer": "Updates every 60s",
  "statusEmbed.none": "No servers configured.",

  // ── /daily messages ──
  "daily.linkRequired": "You must link your Discord account first.",
  "daily.linkRequiredFooter": "Link Required",
  "daily.linkError": "Could not resolve linked account.",
  "daily.linkErrorFooter": "Link Error",
  "daily.dataError": "Daily rewards data unavailable.",
  "daily.dataErrorFooter": "Data Error",
  "daily.queueFullFooter": "Delivery Queue Full",
  "daily.deliveryFailed": "Reward delivery failed. Your claim was not consumed. Please try again in a moment.",
  "daily.deliveryFailedFooter": "Delivery Failed",
  "daily.cooldown": "⏳ Next claim in {hours}h {minutes}m. | Ready at {time}",
  "daily.reward": "🎁 **Daily Reward:** {reward}",
  "daily.bonus": "🔥 **{days}-day bonus:** {rewards}",
  "daily.streak": "📈 Streak: {days} days",

  // ── server events, leaderboard, console relay ──
  "serverEvent.startedTitle": "🟢 Server Started",
  "serverEvent.startedBody": "Server is now online and ready for players.",
  "serverEvent.stoppedTitle": "🔴 Server Stopped",
  "serverEvent.stoppedBody": "Server is shutting down.",
  "serverEvent.uptime": "Uptime: {h}h {m}m",
  "leaderboard.periodDaily": "Daily",
  "leaderboard.periodWeekly": "Weekly",
  "leaderboard.periodMonthly": "Monthly",
  "leaderboard.footerBased": "{period} leaderboard · based on last {hours}h of data",
  "leaderboard.footerPartial": "{period} leaderboard · bot tracking since {hours}h ago (partial period)",
  "leaderboard.footerNoSnapshot": "{period} leaderboard · no snapshot available, showing all-time",
  "leaderboard.noData": "No data available.",
  "leaderboard.tracked": "{count} players tracked",
  "leaderboard.title": "🏆 Leaderboard: {stat}{period}",
  "leaderboard.streakTitle": "🏆 {stat}: {server}",
  "leaderboard.noClaims": "No claims on this server yet.",
  "leaderboard.streakNote": "Top {limit} · /daily streaks are per server",
  "console.dropped": "… {count} line(s) dropped (busy server)",
  "uptime.barNoData": "no data",

  // ── server targeting ──
  "router.guildOnly": "In a multi-server setup, commands must be used inside a Discord server.",
  "router.notAllowed": "Server \"{server}\" is not available from this Discord server. An operator can allow it by adding it to this guild's \"allowedServers\" in config.json.",
  "router.serverNotFound": "Server \"{server}\" not found.",
  "capability.missing": "**{server}** doesn't provide {feature}. This feature needs the setup-suite layout. {hint}",
  "target.defaultNotRunning": "This guild's defaultServer \"{server}\" is not a running server. Fix it in config.json or pass `server:` explicitly. Available: {available}.",
  "target.none": "none",
  "target.noneAvailable": "No server is available for this guild.",
  "target.several": "Several servers are available ({servers}). Pass `server:` to choose one.",
};
