/**
 * English locale (default + fallback).
 *
 * Key convention: `<area>.<message>` in camelCase. Placeholders use
 * {curlyBraces} and are substituted by t() — see utils/i18n.ts.
 *
 * Migration note: existing commands still carry literal English strings;
 * NEW user-visible strings go through t() from day one, and literals can
 * be migrated key-by-key whenever a command is touched. Adding a key here
 * without a German counterpart is fine — de falls back to en per key.
 */
export const en: Record<string, string> = {
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
  "status.hostProcess": "Process: {ram} RAM, {cpu}% CPU",
  "status.hostDisk": "`{path}`: {percent}% used ({free} free)",
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
};
