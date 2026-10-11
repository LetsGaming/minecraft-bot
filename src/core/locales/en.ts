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
  "common.noPermission": "This command is for bot admins only. Ask a bot admin if you need it.",
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
  "daily.queueFull": "{max} rewards are already waiting for you in game. Join the server and collect them before claiming the next one.",
  "daily.queued": "You are offline on **{server}** right now, so the reward is queued and delivered the next time you join. Your streak is safe.",
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
  "state.unresponsiveHint": "The server process is running but is not answering commands. It may be starting up or under heavy load.",
  "state.unknownHint": "Neither the API wrapper nor the server answered, so the state is unknown. Check that the host is reachable.",
  "state.wrapperDownHint": "The server is reachable, but its API wrapper is not. Server controls, the chat bridge, stats and log watching are unavailable until the wrapper answers again.",
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
  "control.stillRunning": "This is taking longer than the bot waits for, so the script may still be running. Check with `/server status` before running it again.",
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
  "help.newToYou": "✨ marks {count|the # command|the # commands} you have not tried yet. They are listed first.",
  "deathpos.hint":
    "Tip: type !deathpos in chat to get these coordinates again at any time.",
  "report.hint":
    "Tip: if that was unfair, type !report <what happened> in chat and the admins will see it.",

  // ── /clear-dm ──
  "clearDm.none": "No bot messages found to delete.",
  "clearDm.deleted": "Deleted **{count}** bot message(s) from this DM.",

  // ── embed helpers ──
  "embed.errorTitle": "Command failed",
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
  "daily.processing": "Your claim is still being processed. Please wait a moment.",
  "streak.noData": "You have no streak on this server yet.",
  "streak.days": "{count|# day|# days}",
  "streak.na": "None",
  // ── /link, /unlink ──
  "link.pending": "You already have a link code: `{code}`. Use it in game, or wait until it expires before asking for a new one.",
  "link.alreadyLinked": "Your account is already linked. To link a different Minecraft account, run /unlink first.",
  "link.instructions": "Join the server and type:\n`!link {code}`\nThe code expires in 5 minutes.",
  "link.notLinked": "Your Discord account is not linked to a Minecraft account. Run /link to link one.",
  "link.status": "Your Discord account is linked to `{account}`.",
  "link.unlinked": "Your Discord account is no longer linked to a Minecraft account.",
  // ── /help, /map, /chunkbase, /seed ──
  "help.title": "Commands",
  "help.required": "**(required)**",
  "help.optional": "(optional)",
  "help.options": "Options",
  "map.notConfigured": "No map link is set up for this bot.",
  "map.title": "Live map",
  "map.description": "You can view the live Minecraft map [here]({url}).",
  "chunkbase.title": "Chunkbase Map",
  "chunkbase.open": "[Open Seed Map]({url})",
  "seed.title": "World Seed: {server}",

  // ── /mods, /status, /uptime ──
  "mods.title": "Mods on {server}",
  "mods.count": "{count|# mod|# mods} installed.",
  "mods.groupBoth": "Client and server",
  "mods.groupOptional": "Client only, optional",
  "mods.groupServer": "Server only",
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
  "whitelisted.empty": "The whitelist is empty. It may be turned off on this server.",
  "whitelisted.title": "Whitelist of {server}",
  "whitelisted.total": "{count|# player|# players} in total.",
  "whitelisted.readFailed": "Could not read the whitelist.",
  // ── shared command messages ──
  "common.rateLimited": "Too many commands. Please wait {seconds}s.",
  "common.unexpectedError": "Something went wrong and the command did not finish.",
  "common.unexpectedErrorRecovery": "Try again in a moment. If it keeps happening, tell a bot admin.",
  "common.playerNotFound": "`{player}` is not known on this server.",
  "pagination.notForYou": "These buttons aren't for you.",

  // ── /stats, /compare, /playtime ──
  "stats.pageTitle": "Stats for {name}",
  "stats.fileNotFound": "No stats for `{player}` yet.",
  "stats.noMatch": "No stats match `{filter}`.",
  "stats.failed": "Could not load the stats.",
  "stats.noSnapshot": "There is no stats snapshot from the last 24 hours to compare with yet.",
  "stats.noChangeFiltered": "No stats matching `{filter}` changed in the last 24h.",
  "stats.noChange": "No stat changes in the last 24h for `{player}`.",
  "stats.dailyLabel": "{player}: last {hours}h",
  "compare.noStats": "`{player1}` and `{player2}` have no stats in common yet.",
  "compare.title": "{player1} compared with {player2}",
  "playtime.statNotFound": "No playtime recorded for `{player}` yet.",
  "playtime.title": "Playtime of {player}",
  "playtime.total": "Total playtime: **{time}**",
  // ── /clear, /backup, /tps ──
  "clear.textChannelOnly": "This command can only be used in a text channel.",
  "clear.deleted": "Deleted **{count}** message(s).",
  "clear.tooOld": "_Messages older than 14 days cannot be bulk-deleted._",
  "backup.none": "No backups yet. A bot admin can create one with /server backup.",
  "backup.title": "Backups of {server}",
  "backup.summary": "{count|# backup|# backups}, {total} in total. The newest was made {age}.",
  "backup.entry": "{count|# backup|# backups}\nLatest {age}, {size}",
  "tps.unsupported": "TPS monitoring requires RCON or an API wrapper.",
  "tps.unavailable": "Could not retrieve TPS. Server may be offline.",
  "tps.title": "{emoji} TPS: {server}",
  "tps.tickTiming": "Tick Timing",
  "tps.current": "Current TPS: **{value}**",

  // ── /server control, whitelist ──
  "control.noOutput": "No output",
  "control.exitCode": "Exited with code {code}",
  "control.failed": "The script ended with exit code {code}.",
  "control.pruneNoWhitelist": "Whitelist is empty or could not be loaded. Refusing to prune, since that would delete every player's stats.",
  "control.pruneNone": "No orphaned stats files on **{server}**, nothing to prune.",
  "control.pruneDryTitle": "Prune stats on {server}: dry run",
  "control.pruneDryBody": "{count|# stats file belongs|# stats files belong} to players not on the whitelist:\n```\n{list}\n```\nRun the command again with `confirm: true` to delete them for good.",
  "control.pruned": "Deleted {count|# orphaned stats file|# orphaned stats files} on **{server}**.",
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
  "daily.linkRequired": "Link your Minecraft account first.",
  "daily.linkError": "The linked Minecraft account could not be found.",
  "daily.dataError": "No daily rewards are set up for this server.",
  "daily.deliveryFailed": "The reward could not be delivered. Your claim was not used up.",
  "daily.cooldown": "The next reward is ready {relative} (at {time}).",
  "daily.reward": "Reward: {reward}",
  "daily.bonus": "{days}-day streak bonus: {rewards}",
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
  "capability.missing": "**{server}** does not provide {feature}. This feature needs the setup suite. {hint}",
  "target.defaultNotRunning": "This guild's defaultServer \"{server}\" is not a running server. Fix it in config.json or pass `server:` explicitly. Available: {available}.",
  "target.none": "none",
  "target.noneAvailable": "No server is available for this guild.",
  "target.several": "Several servers are available ({servers}). Pass `server:` to choose one.",
  "state.playerCount": "{online}/{max} players",
  "state.playersIncluding": "{counts}, including {names}",
  "state.playersNamed": "{counts}: {names}",
  "denied.title": "Bot admins only",
  "denied.command": "/{command} is for bot admins. Ask one of them if you need it.",
  "denied.action": "This is for bot admins. Ask one of them if you need it.",
  "pagination.previous": "Previous",
  "pagination.next": "Next",
  "pagination.page": "Page {page}/{total}",
  "progress.started": "Started {time}.",
  "confirm.expires": "The buttons expire in {seconds} s.",
  "confirm.confirm": "Confirm",
  "confirm.cancel": "Cancel",
  "confirm.cancelled": "Cancelled. Nothing was changed.",
  "confirm.expired": "This confirmation has expired. Run the command again.",
  "confirm.notYours": "Only the person who ran the command can answer this.",
  "common.retryLater": "Try again in a moment.",
  "common.playerNotFoundRecovery": "Check the spelling or pick a name from the suggestions.",
  "common.playerNotFoundTitle": "Player not found",
  "stats.fileNotFoundRecovery": "They appear after the first session on this server.",
  "stats.noStatsTitle": "No stats yet",
  "stats.noMatchRecovery": "Try a shorter filter or leave it empty.",
  "stats.noMatchTitle": "No matching stats",
  "stats.noSnapshotRecovery": "Try again once stats have been recorded for a day.",
  "stats.noSnapshotTitle": "No baseline yet",
  "stats.noActivityTitle": "No activity",
  "stats.total": "{count|# stat|# stats} in total.",
  "compare.shared": "{count|# shared stat|# shared stats}.",
  "playtime.statNotFoundTitle": "No playtime yet",
  "streak.title": "Your daily streak on {server}",
  "streak.current": "Current",
  "streak.longest": "Longest",
  "streak.nextBonus": "Next bonus at",
  "streak.noDataRecovery": "Claim your first reward with /daily.",
  "streak.noDataTitle": "No streak yet",
  "map.notConfiguredRecovery": "A bot admin can add it as the `url` option of the map command.",
  "link.title": "Link your Minecraft account",
  "link.statusTitle": "Linked account",
  "link.unlinkedTitle": "Account unlinked",
  "daily.linkRequiredRecovery": "Run /link, then /daily again.",
  "daily.linkRequiredTitle": "Account not linked",
  "daily.linkErrorRecovery": "Check it with /linkstatus, or link again with /link.",
  "daily.dataErrorRecovery": "Tell a bot admin.",
  "daily.queueFullTitle": "Rewards waiting in game",
  "daily.deliveryFailedTitle": "Reward not delivered",
  "daily.cooldownTitle": "Already claimed",
  "daily.claimedTitle": "Daily reward claimed",
  "daily.streakField": "Streak",
  "daily.nextField": "Next reward",
  "capability.feature.script": "the `{script}` management script",
  "control.progress.start": "Starting {server}",
  "control.progress.stop": "Stopping {server}",
  "control.progress.restart": "Restarting {server}",
  "control.progress.backup": "Backing up {server}",
  "control.progressBody.start": "{user} is starting the server.",
  "control.progressBody.stop": "{user} stopped the server. Players get a 30 second warning, then the world is saved and the server shuts down.",
  "control.progressBody.restart": "{user} restarted the server. Players get a 30 second warning, then the world is saved and the server starts again.",
  "control.progressBody.backup": "{user} started a backup. This can take a few minutes.",
  "control.failedTitle.start": "Could not start {server}",
  "control.failedTitle.stop": "Could not stop {server}",
  "control.failedTitle.restart": "Could not restart {server}",
  "control.failedTitle.backup": "Backup of {server} failed",
  "control.failedRecovery": "A bot admin can find the details in the script output and the server logs.",
  "control.outputTitle": "Script output",
  "control.done.start": "The start script finished. The server is starting up.",
  "control.done.stop": "The server is stopped.",
  "control.done.restart": "The server restarted.",
  "control.done.backup": "The backup is complete.",
  "control.doneTitle.start": "{server} is starting",
  "control.doneTitle.stop": "{server} stopped",
  "control.doneTitle.restart": "{server} restarted",
  "control.doneTitle.backup": "Backup of {server} created",
  "control.confirmTitle.stop": "Stop {server}?",
  "control.confirmTitle.restart": "Restart {server}?",
  "control.confirmBody.stop": "{count|# player is|# players are} online. They get a 30 second warning, then are disconnected. They can rejoin once you start the server again.",
  "control.confirmBody.restart": "{count|# player is|# players are} online. They get a 30 second warning, then are disconnected. They can rejoin once the server is back.",
  "control.confirmBodyEmpty.stop": "Nobody is online. The server saves the world and shuts down.",
  "control.confirmBodyEmpty.restart": "Nobody is online. The server saves the world and starts again.",
  "control.confirmBodyUnknown.stop": "The player list is not available. Anyone online gets a 30 second warning, then is disconnected.",
  "control.confirmBodyUnknown.restart": "The player list is not available. Anyone online gets a 30 second warning, then is disconnected until the server is back.",
  "control.confirmButton.stop": "Stop {server}",
  "control.confirmButton.restart": "Restart {server}",
  "control.confirmed": "Confirmed. The notice about {server} is posted in this channel.",
  "control.statusTitle": "Status script output for {server}",
  "control.prunedTitle": "Stats pruned",
  "capability.feature.modManifest": "a mod manifest (`common/downloaded_versions.json`)",
  "capability.feature.backups": "the backup layout of the setup suite",
  "mods.stale": "This is the last known list, from {age}. The server is not answering right now.",
  "mods.group": "{label} ({count})",
};
