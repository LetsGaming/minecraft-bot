# Cross-server chat relay (plan)

Status: planned, not implemented. This document records what is allowed, what is not, and how the feature fits the existing chat bridge. Build it after the current clean-code wave has merged, because both touch `chatBridge.ts` and the per-channel send queue.

## 1. Goal

A message written in the chat-bridge channel of one Discord server is also posted in the bridge channels of the other Discord servers that share the same Minecraft server. It must not break Discord's terms and must not leak personal data of the Discord user who wrote it.

## 2. Decisions

| Topic | Decision |
|---|---|
| Who relays to whom | Opt-in relay group. Bridges relay to each other only when they name the same `relayGroup` and are bound to the same Minecraft server. Groups never span Minecraft servers. |
| Sender name | The linked Minecraft name if the user ran `/link`, otherwise a censored version of the Discord display name (section 6). No avatar, no Discord id. |
| Source | Every relayed message carries the source label of its guild, set by that guild's admin. |
| Notice and opt-out | Each bridged channel gets a pinned notice that messages are forwarded. Each user can opt out of being relayed. |
| Default for everything else | The most private option (section 5). |

## 3. What the rules require

Sources: Discord Terms of Service (effective 2025-09-29) and Discord Developer Policy (effective 2024-07-08).

| Rule | What it means here |
|---|---|
| Developer Policy 2: no processes on a user's or server's behalf without permission, clearly labelled | Relaying is off unless a guild admin sets `relayGroup`. The setting has a plain name and a description in the dashboard. A guild can never be pulled into a group by another guild. |
| Policy 3: respect opt-outs, blocking and removal | A per-user opt-out. Removing the bot, unsetting `relayGroup` or deleting the channel stops all relaying at once. |
| Policy 15: API Data only for the stated functionality | Message content goes only to the configured targets of the same group. Nothing else uses it. |
| Policy 16: no profiling of users or their relationships | No cross-guild history per user. The relay keeps no record of who talks where beyond the short-lived edit map (section 8). |
| Policies 17 to 21: no brokers, no selling, no scraping, no AI training | No archive of relayed messages, no export, no analysis. |
| Policy 12: no impersonation of apps, staff or Discord services | Relayed messages are always marked with the source label, so a user cannot make a relayed message look like it came from someone else. Webhook names cannot contain "discord" or "clyde". |
| Policies 5 and 7: no unsolicited DMs, no contact outside Discord | The relay never DMs anyone and never uses ids to contact people. |
| Terms, "Other people's content": not usable without that person's consent or as allowed by law | The pinned notice and the opt-out are the consent mechanism. The operator is responsible for the legal basis (see section 10). |
| Terms: no spamming or auto-messaging | Rate limits and loop prevention (section 7). |

## 4. What is possible and what is not

Possible:
- Text relayed through a webhook with a bot-controlled display name.
- Edit and delete sync, using a short-lived map of message ids.
- Admin-controlled labels, per-guild blocklists and a per-user opt-out.

Not allowed, or deliberately not done:
- Relaying Discord ids, avatars, profile data or raw mentions.
- Forwarding attachment links unchanged. Discord CDN links contain the source channel id and they expire.
- Keeping a log of relayed messages.
- Relaying between guilds that have not both opted in.
- Chaining relays from group to group.

## 5. Privacy defaults

| Data | Default |
|---|---|
| Discord user id | Never leaves the bot. Used in memory for rate limiting only. |
| Avatar | Not sent. The webhook uses a generic avatar. |
| Name | Linked Minecraft name, otherwise a censored Discord display name. |
| Mentions (`@everyone`, `@here`, roles, users, channels) | Sent with `allowed_mentions: { parse: [] }`, and the visible text is rewritten to plain words (section 6). |
| Custom emoji | Replaced by their `:name:` text. |
| Attachments, stickers, embeds | Replaced by a short placeholder such as `[image]`. Not re-uploaded. |
| Replies | Shown as a plain `(reply)` marker. The replied-to text is not quoted. |
| Message bodies | Not stored. The edit map holds ids only. |

## 6. Sender identity

Rule, in this order:
1. If the author has a linked account (`getLinkedAccount` in `linkUtils.ts`), use the Minecraft name.
2. Otherwise use a censored form of the Discord display name.

Censoring:
- Work on code points, not UTF-16 units, so emoji and non-Latin names are not cut in half.
- Keep the first character and replace the rest with a fixed-length mask, for example `S***`. The mask length is fixed so the name length does not leak.
- Strip control and format characters first (reuse the `sanitizeForComponent` approach in `sanitize.ts`).
- Strip any trailing `[...]` or `(...)` from the original name so a user cannot imitate a source label.
- Optional disambiguator (open question 1): append a short tag such as `#4f2`, derived with HMAC-SHA256 over the user id with a secret that is local to the relay group, truncated to 3 hex characters. It lets readers tell two speakers apart without exposing anything that can be reversed or linked outside the group.

The final webhook username is `<name> [<label>]`, at most 80 characters. If Discord rejects the username, fall back to the embed path, as `deliver` already does for the Minecraft direction.

Using the Minecraft name: the user created that link themselves with `/link`, and the name is already public on the Minecraft server. The user docs must say that linking means the name may appear in relays.

## 7. Behaviour

Flow for a message in bridge channel A (group G, server S):
1. Existing guards run first: ignore bots and webhooks, ignore channels with no bridge, rate limit per author.
2. Skip if the author opted out or is on a blocklist. The author gets a quiet marker (reaction) so they know it stayed local.
3. Build the relay payload with the privacy transforms from section 5 and the name from section 6.
4. Send to every other bridge in group G through `enqueueSend` (ordered per channel).
5. Send to Minecraft as today. The in-game prefix uses the same identity as the relay, so the censoring cannot be bypassed by reading chat in game (open question 2).

Rules:
- No chaining: a relayed post is a bot message, so the target channel's listener ignores it.
- Per-group rate limit on top of the per-author limit. Over the limit, drop and react.
- A bridge in a group must exist on both sides. If one side has no webhook permission, fall back to the embed path.
- Minecraft-originated lines are unchanged: they already go to every bridge bound to that server.
- Content filters: reject empty content after transforms, cap at 2000 characters.

## 8. Edit and delete sync

- Keep an in-memory map from source message id to the target webhook message ids, with a short window (default 1 hour, `relay.syncWindowMinutes`).
- Delete in the source: delete the relayed copies. Edit in the source: edit the copies (transforms re-run).
- Memory only, so a restart simply ends the window. No database table, no personal data at rest.
- Needs the `messageUpdate` and `messageDelete` handlers, which the bridge does not have today.

## 9. Config and surfaces

Schema (`src/schema/config.ts`, `GuildChatBridgeConfig`):
- `relayGroup?: string`: group name. Absent means no relaying.
- Guild level `bridgeLabel?: string`: the source label, defaults to the guild's configured name.

Validation (`src/core/configValidation.ts`):
- Error: `relayGroup` set on a bridge that has no resolvable server.
- Error: two bridges of the same group bound to different servers.
- Warning: a group with only one bridge (nothing to relay to).
- Warning: no `bridgeLabel`, or two labels equal within one group.
- Tenant isolation: a group is only valid when every member guild is allowed to reach that server.

Other surfaces:
- Dashboard guild wizard: the relay group field and label, with a plain-language description.
- `/bridge optout` and `/bridge optin` (user commands). Store: a small key in `kv` through a new store using `kvMutate`; it holds only Discord ids of users who opted out.
- Pinned notice in each bridged channel, posted once and tracked by message id so it can be refreshed.
- Locale keys under a new `bridge.*` namespace in `en.ts` and `de.ts`, including the notice text.
- Docs: `docs/user/chat-bridge.md` (what users see, the opt-out, what linking implies), `docs/admin/configuration.md`, `docs/admin/setup.md` (permissions), and an update to the "Cross-server network chat" entry in `docs/ROADMAP.md`, which currently says it is deferred and must be an explicit opt-in block.

## 10. Operator responsibilities (to document)

- The operator of the bot decides the legal basis for forwarding messages between communities (for example consent through the notice, or legitimate interest) and informs members.
- Members can ask for deletion. Deleting the source message deletes the copies within the sync window. Beyond that, copies in other guilds are outside what the bot can remove.
- Privacy of the third-party avatar host: Minecraft-originated messages still use the player head from `mc-heads.net`, which receives the player name. Offer a switch to turn heads off (open question 3).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Abuse or harassment crossing communities | Per-guild blocklist, per-user opt-out, group rate limit, admin can unlink at once. |
| Name spoofing | Bot-controlled label, trailing brackets stripped from names. |
| Loops | Bot and webhook messages ignored, no chaining. |
| Leaks through formatting | Mentions, emoji, links to Discord channels and attachments rewritten before sending. |
| Webhook limits | Existing queue plus per-group limit. |
| Message Content intent is privileged | Already required by the bridge. Any verification or review obligations at 100 or more servers apply. |

## 12. Build plan

Phases, to run after the clean-code wave is merged:

| Phase | Work |
|---|---|
| R0 | Schema, validation, labels, tests. No runtime behaviour. |
| R1 | Relay core: text only, group fan-out through `enqueueSend`, identity function, mention and emoji rewriting. |
| R2 | Opt-out store, `/bridge optout` and `/bridge optin`, blocklist, pinned notice. |
| R3 | Edit and delete sync with the in-memory map. |
| R4 | Dashboard wizard, locale keys (en and de), docs. |
| R5 | Hardening: group rate limit, tests for loops, spoofing, mention leaks, fallback paths. |

Phases R1 to R3 share `chatBridge.ts`, so they run in sequence on one branch.

Tests: transform unit tests (mentions, emoji, names with brackets, long names, non-Latin names), identity tests (linked vs unlinked), loop tests (relayed post is ignored), opt-out tests, validation tests, edit and delete tests, and a check that the payload contains no user id or avatar.

## 13. Open questions

1. Disambiguator: add the short `#xxx` tag after the censored name (more readable conversations), or leave names as `S***` only (more private)? Recommendation: add the tag.
2. In-game prefix: apply the same censored identity to the `[Name]` shown to players on the Minecraft server? Recommendation: yes, otherwise the censoring only protects Discord readers.
3. Avatar switch: add a config option to turn off player heads for Minecraft-originated messages in relay groups, to avoid sending names to `mc-heads.net`? Recommendation: yes, default on for relay groups.
4. Opt-out default scope: global per user, or per guild? Recommendation: global per user, simpler to explain.
