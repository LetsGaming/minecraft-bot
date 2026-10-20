# Roadmap

Last updated: October 2026, against **v8.1.0** plus the unreleased changes in
[CHANGELOG.md](../CHANGELOG.md).

What shipped, version by version, is in the changelog; why things are built the
way they are is in [dev/decisions.md](dev/decisions.md). This file only tracks
what is open, what is planned and what is deliberately not on the list.

## The short version

| Item | Status |
|---|---|
| Cross-server chat relay | shipped ([user/chat-bridge.md](user/chat-bridge.md#messages-forwarded-to-other-discord-servers)) |
| Dashboard phase 4 (public status and leaderboard pages) | open, only if there is demand |
| A local break-glass login for the dashboard | deliberately not built |
| Whitelist-application niceties (auto-role on approval) | open |
| More locales | open; one file plus the parity check |
| Mod config editor | shipped ([user/mod-config-editor.md](user/mod-config-editor.md)) |
| Dashboard Players page and Analytics tabs | shipped in 8.1.0 |
| Everything on the 3.6.0 and 5.x lists | shipped |

## Open, uncommitted

- **Dashboard phase 4**: public (login-free) status and leaderboard pages.
  Everything else stays admin-only. Only if there is demand, and nothing has
  created any: the retired panel's login-free status page was looked at and
  dropped rather than replaced. If it is ever built it should be designed as a
  public page, not reconstructed from what the panel exposed.
- **Whitelist-application niceties**: optional auto-role on approval. The
  decided applications are already visible per player on the dashboard's
  Players page.
- **More locales**: the i18n layer is table-driven, so a third language is one
  file plus the parity check. The dashboard itself is English only (see
  [dev/decisions.md](dev/decisions.md)).

## Not planned

- **A local break-glass login.** The dashboard is Discord-OAuth2 only. SSH plus
  the wrapper API key already covers the case
  ([admin/emergency-access.md](admin/emergency-access.md)). Revisit if that
  runbook turns out to be needed more than about once a year.
- **A moderation surface in the dashboard** (kick, ban, notes). Moderation stays
  in Discord, where it is audited; the Players page only reads.
- A hosted public instance. The config model assumes one operator who owns the
  process; self-hosting stays the deployment story.
- Minigames or an economy beyond the daily reward. Server-side plugins do this
  better.
- Discord message moderation or automod. Other bots specialize in it.

## How items get picked

Correctness and data safety first, then features that save admin time, then
player-facing polish. Issues and PRs that target a single roadmap item are much
easier to review than combined ones.
