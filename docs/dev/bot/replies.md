# Discord replies

How a message from the bot looks and behaves: colour, title, fields, who sees
it, how it pages and whom it may ping. The builders in
[`src/bot/utils/embeds/`](../../../src/bot/utils/embeds/) implement these rules;
use them and the rules come for free. The values (colours, limits, timeouts)
live in the code linked here, not in this page.

## Builders

| Need | Use |
|---|---|
| Any embed | `createEmbed` in [`embedUtils.ts`](../../../src/bot/utils/embeds/embedUtils.ts). Cuts title, description and footer to Discord's limits so a long name can never fail the reply |
| Something is done | `createSuccessEmbed` |
| A neutral answer | `createInfoEmbed` |
| A job still running | `createProgressEmbed`: the start time is a Discord timestamp, so the elapsed time counts up in every client without edits |
| A failure | Throw a `CommandError` (below), or `createErrorEmbed` through `replyError` |
| A server state | `createEmbed({ state })`: the state's circle goes in front of the title and the state picks the colour. `describeState` / `describeHealth` in [`serverStateDisplay.ts`](../../../src/bot/utils/embeds/serverStateDisplay.ts) give the label and the hint sentence |
| A player event | `createPlayerEmbed`: the player's head and name as the author |
| A confirmation | `createConfirmEmbed` and `createConfirmRow` in [`confirm.ts`](../../../src/bot/utils/embeds/confirm.ts) (below) |

No naked `new EmbedBuilder()` and no colour literals.

## Colour is status

`EmbedColor` in [`embedColors.ts`](../../../src/bot/utils/embeds/embedColors.ts)
maps every colour to a status role of
[`STATUS_TABLE`](../../../src/schema/status.ts), the table the dashboard chips
use, so Discord and the dashboard cannot drift apart:

| `EmbedColor` | Status role | Use |
|---|---|---|
| `Online`, `Success` | online, applied | Running, done; also the only celebration colour (a won challenge) |
| `Warning` | degraded | Not responding, low TPS, wrapper down while the server is fine |
| `Error` | offline | Stopped, failed, denied |
| `Neutral` | unknown | No data, and plain events: join, leave, death, advancement |
| `Pending` | pending | Waiting for someone: confirmations, whitelist applications |
| `Info` | info | Answers and running jobs (the default) |

## Titles, emoji, fields, footers, timestamps

- **Title** names the object or the action, in sentence case: "Backups of smp",
  "Player banned", "smp is offline". "Command failed" is the fallback for an
  error without its own title, never the plan.
- **Emoji**: the server state circle (`statusCircle`) is the only emoji a title
  may carry. Others may appear inside a description.
- **Fields**: identity first, then measures, free text last.
- **Footer**: empty by default. No "Requested by", no page number (the pager
  shows it). A server id only where several servers share a channel (the event
  broadcaster adds it when more than one server is configured).
- **Timestamp**: only on live data (status, uptime, TPS, alerts). Times inside
  text are Discord timestamps (`relativeTimestamp`, `clockTimestamp` in
  [`discordTime.ts`](../../../src/bot/utils/discordTime.ts)), so every reader
  sees their own time zone.

## Who sees a reply

Commands run inside `withErrorHandling` in
[`middleware.ts`](../../../src/bot/commands/middleware.ts). It enters the
guild's locale, defers, catches, and keeps errors private.

- **Only the invoker**: errors, permission denials, confirmations, cooldowns,
  personal data and config. `replyError`, `replyPrivate` and `replyDenied`
  handle every interaction state: a public "thinking..." placeholder is deleted
  and the message goes out as an ephemeral follow-up, so a public placeholder
  never turns into a public error.
- **Public**: status, stats, leaderboards, moderation outcomes, the notice that
  a server is being stopped, and a claimed `/daily` reward. Pass
  `{ ephemeral: true }` to `withErrorHandling` for a command whose every reply
  is private.
- **Admin gate**: wrap the executor in `requireServerAdmin` inside
  `withErrorHandling`. The check runs before the defer, so a denial is never
  public, and it is the same "Bot admins only" embed everywhere (the
  dispatcher's `adminOnly` policy uses it too).

## Errors

Throw `CommandError` from
[`core/utils/error.ts`](../../../src/core/utils/error.ts) with a `problem`, a
`recovery` (what to do next) and, where it helps, a `title` naming the failed
action. The middleware renders problem, then recovery, in a red embed visible
only to the invoker. Never put config paths, ids, stack text or raw wrapper or
script output in front of a non-admin; script output goes to the admin only
(`control.ts` shows the pattern). A thrown plain `Error` shows its message as
the problem, so prefer `CommandError` with localised text. A failure to reach
the API wrapper (unreachable, timed out, circuit breaker open, rate limited;
`classifyTransportError` in
[`core/utils/server/transportError.ts`](../../../src/core/utils/server/transportError.ts))
becomes "Could not reach smp" with a localised problem and recovery. A 5xx
answer from the wrapper (an `ApiError` from
[`apiClient.ts`](../../../src/core/utils/server/access/apiClient.ts) with its
`status`) becomes "smp had a problem" the same way. In both cases the raw cause
goes to the log only.

## Confirm rows

Destructive actions ask first: one ephemeral pending embed with a footer saying
when the buttons expire, and one row with a danger button and Cancel. The
custom id carries action, server, user and expiry
(`confirm:<yes|no>:<action>:<server>:<user>:<expiry>`), so a press still works
after a bot restart and an expired press is refused by the id alone.

To add one, register the action with `registerConfirmAction` in
[`interactions/confirmActions.ts`](../../../src/bot/interactions/confirmActions.ts),
reply with `createConfirmEmbed` and `createConfirmRow(confirmTarget(...))`, and
call `scheduleConfirmExpiry` so the buttons switch off when they expire. Only
the invoker may press them; admin actions re-check admin status at press time.
`/server stop` and `/server restart` in
[`control.ts`](../../../src/bot/commands/server/control.ts) are the reference.

## Pagination and limits

`EMBED_LIMITS` in `embedUtils.ts` holds Discord's hard limits. Never build a
list that can outgrow them:

- `paginateFields` splits fields into pages that stay under the field count and
  the 6000 character total, counting the embed's own title and description
  (`reservedLength`). `chunkLines` packs lines into field values;
  `paginateLines` splits lines into description pages.
- `createPaginationButtons` is Previous, a disabled "Page n/m" button, Next.
  `handlePagination` drives it and, after `PAGINATION_TIMEOUT_MS`, switches the
  row off instead of removing it, through the interaction so it also works on
  ephemeral replies. Button events arrive outside the command's locale context,
  so pass the guild id.

## Mentions

Every send that can carry text someone else wrote sets `allowedMentions`
explicitly, using the helpers in
[`alertUtils.ts`](../../../src/bot/utils/embeds/alertUtils.ts):

- relayed text (chat bridge, live console, reports, event notifications) uses
  `safeMentions("none")` and can ping nobody, even if it contains `@everyone`;
- alerts use `alertMention(role, policy, previous, next)`, which allows exactly
  the configured role and nothing else.

The guild's `mentionPolicy` decides when an alert pings:
`escalation` (the default, also used for an unknown value: the first failure
and a rise in severity only; recoveries and repeats are silent) or `always`
(every alert). `shouldPing` holds the rule. See [configuration.md](../../admin/configuration.md) for the config
side.

## Language

Every user-visible string goes through `t()` with keys in both
[`en.ts`](../../../src/core/locales/en.ts) and
[`de.ts`](../../../src/core/locales/de.ts). German uses du-form and one word
per concept:

| Concept | German |
|---|---|
| Minecraft server | "Server" (or "Minecraft-Server" where both servers appear) |
| Discord guild | "Discord-Server"; never "Guild" or "Gilde" in user-facing text |
| Bot admin | "Bot-Admin" |
| Channel | "Kanal" (as in Discord's German UI) |
| API wrapper | "der API-Wrapper" (masculine) |
| Claiming a reward | verb "abholen", noun "Belohnung"; "Daily" stays as a name |
| Streak | "Serie" |
| Application | "Antrag" |
| A `/watch` subscription | "Benachrichtigung" |
| Waypoint | "Waypoint" |

No gendered forms such as "Erste(r)" (rephrase neutrally), no "(s)" or "(en)"
plurals (use `{count|one|other}`), no dashes. Shared terms (status labels,
backup types) come from the glossary in `@mcbot/schema`.

Text built for a guild must be built inside that guild's locale context:
`withErrorHandling` enters it for commands, and the broadcasters
(`broadcastNotification`, the alert senders) enter it per guild. A string
computed before the loop lands in the global language for everyone.

Two checks hold the copy to Discord's rules:

- `npm run i18n:check` fails when the locales diverge or a literal reaches a
  Discord reply outside `t()` (`scripts/lib/i18nLiteralLint.mjs`).
- `tests/core/localeLimits.test.ts` checks every locale string used as a modal
  title or label, button label, placeholder, select option or embed title
  against Discord's length limits in both languages.

## Snapshots

`tests/bot/discordSnapshots/` renders a fixed set of replies (status in every
state, the stop confirmation, denial and errors, paged lists, alerts, events,
`/daily`, a whitelist application, `/backup`) through the real commands,
watchers and builders in English and German, and writes them to
`tests/fixtures/discord-snapshots/`. They run with `npm test`; a change to a
reply shows up as a fixture diff in review. `npm run discord:snapshots` prints
them as text, and `npm run discord:snapshots -- --update` rewrites them after an
intended change.
