# Feature and Improvement Opportunity Review

> **Status (2026-10-19):** FO-002 (as a section of FO-004), FO-004, FO-005 and FO-006 are implemented on `feat/players-and-analytics` with the retention values suggested here (activity 90 days, sessions 365 days). FO-001 and FO-003 are still open. The text below is the review as written and is kept for the reasoning.

Date: 2026-10-19. Against: v8.0.0 plus the merged Wave 4 clean-code PR (#33, main at f36fcf1).
Scope: review only. Nothing in the project was changed except this file.

## 1. Executive Summary

The project is a mature, self-hosted Discord bot plus optional dashboard for running Minecraft servers. By its own roadmap and changelog, the large backlog is already shipped (chat bridge, stats, rewards, ops, mods, prune, upgrade, capability-based dashboard). The honest finding is that **very little clears the anti-bloat bar**. The best opportunities are small and are mostly about keeping the project legible, not about adding surface.

Top recommendations, in order:

1. **FO-001 Bring `docs/ROADMAP.md` and `docs/features.md` back in line with 8.0.0** (improvement, quick win). Both documents describe a product two major versions old.
2. **FO-002 Whitelist application history, read-only** (improvement, small). The data is already stored and has no viewer.
3. **FO-003 Merge `/top` and `/leaderboard`** (simplification, tiny, optional). They are two commands over one implementation.
4. **FO-005 Rework Analytics around Players and Server tabs** (improvement, medium; owner-requested). Activity chart, leaderboard and players first; uptime and command usage demoted.
5. **FO-006 Deepen stored history** (improvement; small for activity, medium for sessions). Owner-decided. Raise activity retention (one constant) and move sessions from a JSON document into a table with age-based retention. Do this first; the rework and the audit depend on it.
6. **FO-004 Player audit: a searchable Players nav page with per-player overview** (new feature, medium; modelled on leck-eier-bot's memberAudit, see Section 6). Absorbs FO-002. FO-005 and FO-004 should be planned together because the Analytics rows link into the audit.

Quick wins: FO-001. Deliberately not building: dashboard moderation actions, a persistent player roster table, a public dashboard, a break-glass login, more locales and the cross-server relay (the last two were excluded by the owner; relay is already designed in `docs/dev/cross-server-relay.md`).

## 2. Current State and Method

**What it is.** A TypeScript npm-workspaces monorepo (`src/{schema,core,bot,web}`). The bot reaches each Minecraft server only through the `minecraft-server-api` wrapper. Machine state lives in SQLite; human config stays JSON. The dashboard is Fastify plus Vue/PrimeVue with per-capability access.

**Design philosophy (as recorded in `docs/ROADMAP.md` and `docs/dev/decisions.md`).** One operator who owns the process; self-hosted only; remove duplicate code paths rather than maintain two (5.0.0 and 5.1.0 both did this); correctness and data safety first, then admin time saved, then player polish. Explicit non-goals: hosted instance, minigames or economy, Discord automod.

**What I examined.** `docs/ROADMAP.md`, `docs/features.md`, the `[Unreleased]` changelog, the heading list of `docs/dev/decisions.md`, the command tree under `src/bot/commands`, dashboard routes and views (`src/web/backend/routes`, `src/web/frontend/src/views`, router nav), the store inventory in `src/core/utils/stores`, the whitelist application store, and `analytics.ts` route names.

**Interview answers (taken as given).**
- Users: the owner and friends, small scale, roughly 1 to 3 servers (assumed from the answer "just me and friends").
- Goal: balanced between player engagement and operator time.
- Excluded: cross-server relay, new locales.
- Report location: `docs/dev/feature-review.md`, uncommitted.

**Key assumptions.** Usage data (which commands and dashboard pages are actually used) was not available. Demand claims below are therefore inference, and each recommendation says so.

## 3. Recommendations

### Improvements to existing features

#### FO-001: Refresh ROADMAP.md and features.md to match 8.0.0 (type: Improvement)

- **Value / Effort / Fit-Risk:** Medium / Small / Excellent fit, near-zero risk. Anyone (including future agents, which the repo is built around) reads these first; wrong maps cost more than any missing feature.
- **Rationale and evidence:**
  - `docs/ROADMAP.md` header says "Last updated: August 2026, against v5.1.0"; `package.json` is 8.0.0.
  - ROADMAP still lists **Mod config editor** as "open", but `docs/user/mod-config-editor.md` and `ModConfigView.vue` exist, so it shipped.
  - ROADMAP lists **Cross-server network chat** as "deliberately deferred", but the relay is now designed (`docs/dev/cross-server-relay.md`) and prioritized next.
  - `docs/features.md` dashboard section does not mention Prune chunks, Server upgrade, the Mods page, Analytics, Appearance, or the live-rewards editor beyond one line (a grep for prune/upgrade/analytics in that file returns 0 hits). All of these are in the router (`nav.prune`, `nav.upgrade`, `nav.analytics`, and so on).
  - `CLAUDE.md` says docs link to code and "the code is right"; stale prose still misleads before that rule is reached.
- **Proposed scope:** Edit the two files only. Update the status table, move shipped items out of "open", add the missing dashboard pages to the feature list, restate relay status. Prefer deleting the per-version narrative ("What 5.x changed") in favor of links to `decisions.md`, so the file stops aging.
- **Explicitly out of scope:** A generated docs system, a docs-drift CI check, or restructuring the docs tree.
- **Costs and risks:** Almost none. Risk is only that it goes stale again; trimming narrative reduces that. Per `CLAUDE.md`, user-facing doc edits for a shipped change do not need a changelog entry.
- **Confidence:** Evidence-backed.

#### FO-002: Read-only whitelist application history (type: Improvement; best delivered as a section of FO-004)

- **Value / Effort / Fit-Risk:** Low to Medium / Small / Good fit, low risk. Already named in the ROADMAP's open list ("an application history view for admins; the store already keeps decided applications").
- **Rationale and evidence:**
  - `whitelistApplicationStore.ts` keeps every pending application plus the newest 200 decided ones (`MAX_DECIDED_APPLICATIONS = 200`), with `status`, `decidedBy`, `decidedAt`, `mcName`, `note`. Nothing reads decided rows after the review message is settled.
  - Today an admin who wants to know "did we already deny this person, and who did it" has no way to ask.
  - No data model change, no new store.
- **Proposed scope:** One read-only listing of decided applications (newest first, filter by status or name) for admins of that guild. Surface choice (a Discord admin subcommand versus a dashboard table) is left to planning; the Discord option reuses `paged.ts`, the dashboard option reuses the guild routes.
- **Explicitly out of scope:** Auto-role on approval, re-opening decided applications, export, retention beyond the existing 200, editing.
- **Costs and risks:** One more command or page to document and translate (en and de parity check). Shows Discord user tags and Minecraft names, so it must stay admin-gated like the review channel.
- **Confidence:** Reasonable inference. The value depends on how often applications are used at this community's size; if applications are rare, skip this.

#### FO-005: Rework the Analytics page around the two things that get used (type: Improvement)

Added after the owner said the page's features are "good but not really useful", that the Player Activity chart and the leaderboard are what gets used, and that it "needs to be reworked". Decisions taken in the follow-up interview: two tabs (Players and Server); Uptime and Command usage demoted to the secondary tab; the player audit (FO-004) gets its own nav page.

- **Value / Effort / Fit-Risk:** High (owner-stated, and it is the page they open) / Medium / Good fit. Mostly frontend; the data and routes exist. Risk is churn in a page with i18n-free but accessibility-tested markup.
- **Rationale and evidence** (from `AnalyticsView.vue`, `routes/analytics.ts`, `src/schema/analytics.ts`):
  - The page is five stacked, equal-weight panels: Uptime, Activity, Leaderboard, Players, Command usage. Its own header comment describes it as "the data the bot already collects, finally reachable from the dashboard", i.e. it was built as an exposure of existing stores, not around a question an operator asks.
  - One range selector sits over sections whose stores retain different spans (`ANALYTICS_RETENTION_DAYS`: activity 14, uptime 30, leaderboard 32, commands 90), so the same "range" means different coverage per panel, and the page needs per-section footnotes to explain it.
  - The Players table is the "who is still around and who stopped coming" panel by its own comment, but it only offers column sorting; there is no "gone quiet" or "new" view, and rows link nowhere. Leaderboard names link nowhere either.
  - Uptime and command usage are server-health and bot-usage views; the owner reports the player-centric ones are what is used. At friends scale the command counters are the least actionable.
- **Proposed scope (smallest worthwhile):**
  - **Players tab (default):** the activity chart and busiest hours, the leaderboard, and the players table, with player names in the leaderboard and table linking to the player audit (FO-004). Add two derived views over data the players route already returns: a "gone quiet" filter (last seen older than N days) and a "new this range" filter (first seen inside the range). No new data.
  - **Server tab:** uptime windows and command usage, compact, as they are today minus the equal weight.
  - **Activity chart polish** limited to what the existing `ActivityHour` data supports (avg and peak per hour): show the peak as well as the average, and a day-level summary on hover. Larger chart changes only if the owner names what is missing.
  - **Range honesty:** show each panel's actual covered range next to its title (the routes already return the clamped `rangeHours`), instead of one global selector plus footnotes.
- **Explicitly out of scope:** new metrics or collectors, a charting library, per-player charts on this page (those belong to the audit), real-time updates, cross-server aggregation, redesigning the leaderboard builder (it intentionally shares code with `/leaderboard`).
- **Costs and risks:**
  - The activity history was only 14 days, which limits any trend view. The owner decided to expand it; FO-006 covers how (verified against the store code). Do FO-006 first so the reworked chart is designed for the longer range, including the longer-range selector options.
  - Until FO-006's session table lands, "gone quiet" is reliable but "new this range" and long-range playtime come from at most 20 retained sessions per player; keep the existing retained-sessions note.
  - Moving panels changes a view with sort/pagination state and ARIA wiring; the existing tests and accessibility attributes need to follow.
- **Confidence:** Evidence-backed on structure; assumption-dependent on what "not useful" means. I inferred it from the owner's description and the code. If the real complaint is something specific (for example, the chart cannot show a quiet week), that should drive the first change.

#### FO-006: Deepen the history the Analytics and audit pages draw on (type: Improvement)

Decision from the owner: history depth should expand. Verified against the store code, which splits the work into an easy half and a half that is not just a constant.

- **Value / Effort / Fit-Risk:** High for the rework and audit (it caps what both can show) / Small for activity, Medium for sessions / Good fit.
- **Rationale and evidence:**
  - **Activity (easy, confirmed).** `player_count_hours` is a real SQL table, one aggregate row per server per hour. Its prune is a single `DELETE ... WHERE h < ?` driven by `RETENTION_HOURS = ANALYTICS_CAP_HOURS.activity`, which comes from `ANALYTICS_RETENTION_DAYS.activity = 14` in `src/schema/analytics.ts`. The route clamp and the frontend labels read the same value. At 90 days that is about 2,160 small rows per server. One constant changes the prune, the clamp and the labels together.
  - **Sessions (not just a constant).** `sessionStore.ts` keeps sessions inside one whole-document JSON value in `kv_store`, newest 20 per player (`MAX_SESSIONS_PER_PLAYER`). Every read loads the whole document and every join or leave rewrites it. Raising the cap makes that one document grow with players times sessions and slows every consumer of it. Raising the number alone is cheap to type but is the wrong shape for deeper history.
  - **Leaderboard and uptime.** Stat snapshots are kept for the longest leaderboard period plus two days (32 days), and uptime for 30 days. Only worth touching if the rework wants longer comparisons; not needed for the audit.
- **Proposed scope (smallest worthwhile):**
  1. Raise `ANALYTICS_RETENTION_DAYS.activity` (14 to a longer value; the owner picks, 90 days is a sensible starting point and still tiny). Update the docs that state 14 days (`docs/admin/automated-features.md` mentions "14-day retention"). Existing data simply starts to accumulate; there is no backfill, so the chart fills in over time.
  2. Move sessions out of the JSON document into a `player_sessions` table (a migration; one row per session with server, lowercased name, joined and left times, indexed by server and name). Keep the existing store functions as the single owner so callers (`/whois`, `/sessions`, analytics, the audit) do not change shape. Import the current ring-buffer data on migration so nothing is lost, then retain by age (for example a year) instead of by count. The `importLegacy` and migration-checksum conventions already exist for this.
  3. Make the audit and the "gone quiet" and "new" filters read the table, so they are no longer capped to the last 20 sessions.
- **Explicitly out of scope:** a time-series database, per-minute player counts, storing chat or per-event logs, unlimited retention, changing notes' 25-per-player cap (a moderation convention, not history), backfilling data that was never collected.
- **Costs and risks:**
  - The sessions migration touches a hot write path (every join and leave) and a store several features read; it needs the full test pass the project already runs, and care around the open-session case (`leftAt` null) and `closeAllOpenSessions` on shutdown.
  - Age-based retention needs a periodic prune; follow the pattern in `uptimeTracker.ts` and `commandUsage.ts`.
  - More stored history on a shared SQLite file written by both bot and dashboard: negligible at this size, but keep the prune in the same transaction style as the other stores.
- **Confidence:** Evidence-backed for activity and sessions (read from the store code). The exact retention values are the owner's call.

### New features

#### FO-004: Player audit: searchable Players page with a per-player overview (type: New feature)

Revised twice. First after studying the `memberAudit` work in `leck-eier-bot` (Section 6), which replaced the earlier rejection of a Players page. Then after the owner asked for a player audit "similar to what the other bot has" alongside the Analytics rework, and chose a dedicated nav page. It absorbs FO-002 as one of its sections.

- **Value / Effort / Fit-Risk:** Medium / Medium / Good fit. Reuses existing stores and the Analytics players table; main risk is privacy gating and identity keying (below).
- **Rationale and evidence:**
  - Everything known about one player is split across silos that only meet inside the Discord `/whois` embed: `sessionStore` (sessions, last seen), `noteStore` (admin notes), `linkStore` (Discord link), `whitelistAudit` (who added them, uuid), `whitelistApplicationStore` (decisions), `tempBanStore`, `milestoneStore`, plus stats and daily streak. `whois.ts` itself joins only audit, link, sessions and notes.
  - The dashboard Analytics page lists players (`/analytics/players`: name, playtime, sessions, last seen, online) but a row goes nowhere. The leck-eier equivalent had the same shape (a list whose rows linked nowhere) and fixed it with a per-person overview plus cross-links.
  - The dashboard is where non-SSH, non-Discord-admin people (the capability model) work; today they cannot see a player's history at all.
- **Proposed scope (smallest worthwhile):**
  - A new **Players** nav page: a searchable, server-side-paged list (plain prefix and substring match on name, as the other bot's reviews recommend), opened to a per-player detail view. Analytics rows and leaderboard names link into it (FO-005).
  - One read-only detail endpoint, `GET /api/servers/:id/players/:name`, that aggregates the existing stores on request, plus a paged list endpoint for the search. Sections: identity (name, uuid when known, linked Discord account), activity (retained sessions, first and last seen), moderation context (notes, whitelist audit, application decisions, active temp ban), and rewards (streak). Empty sections render as empty, never as errors.
  - Response type lives in `@mcbot/schema` (the existing contract rule), so backend and frontend cannot drift.
  - Sensitive sections (notes, Discord link, applications, bans) are gated separately from the base profile; reuse an existing capability such as `audit:read` rather than adding a new one, unless planning finds that too coarse.
  - No new table in the first version.
- **Explicitly out of scope:** any write action (notes, ban, kick, whitelist stay in Discord), a global cross-server player search, a persistent "roster" table, renaming or restructuring the Analytics page, former-player archival, a global cross-server search, any change to session or note retention in the first version (see open question below).
- **Costs and risks:**
  - Privacy: it puts Discord ID to Minecraft name links and moderation notes on a web page; gating must be explicit and tested.
  - Data limits are visible to the user: sessions are a ring buffer of 20 per player (`MAX_SESSIONS_PER_PLAYER`) and notes cap at 25, so the page must say "retained sessions only", as the analytics route already does.
  - Identity: sessions are keyed by lowercased name per server, notes by uuid or name; a renamed player splits history. Acceptable in v1; the page should show uuid-linked data when available and not pretend otherwise.
  - Another page to keep in the locale-free dashboard (English only per the Wave 2 decision), so no i18n parity cost.
  - History depth is decided: expand it (FO-006). The audit should read the `player_sessions` table from FO-006 rather than the 20-session buffer, so a very active player's audit shows months, not weeks.
- **Confidence:** Evidence-backed on feasibility and on the pattern (it worked in the other bot). The owner has now stated the need directly, so the "no usage data" doubt from the first revision is resolved in favour of building it; the value still depends on the page staying read-only and fast.

### Simplifications

#### FO-003: Merge `/top` and `/leaderboard` (type: Simplification)

- **Value / Effort / Fit-Risk:** Low / Tiny / Fine, small user-visible risk (command muscle memory, command-policy overrides keyed by name).
- **Rationale and evidence:** `src/bot/commands/stats/top.ts` and `leaderboard.ts` are both four-line files calling `buildLeaderboardData(<name>)` and `executeLeaderboard`; they are the same command under two names. Two entries also mean two help lines, two policy rows in the Commands page, and two locale descriptions.
- **Proposed scope:** Keep one (likely `/leaderboard`, matching the scheduled-leaderboard vocabulary), drop the other, note it in the changelog under Changed/Removed. Check `docs/user/commands.md` and any per-scope command overrides in configs first.
- **Explicitly out of scope:** Redesigning leaderboard categories or the shared builder.
- **Costs and risks:** Operators with `commandOverrides` for the removed name would carry a dead entry. If the alias is intentional (discoverability for players who guess `/top`), the saving is not worth it and this should be dropped.
- **Confidence:** Evidence-backed for the duplication; assumption-dependent on whether the alias is deliberate.

## 4. Considered and Rejected

- **A dashboard moderation surface** (kick, ban, pardon, add note from the dashboard). Moderation stays Discord-first and audited; the read-only player overview (FO-004) deliberately has no write actions. (The earlier blanket rejection of a Players page was revised, see FO-004 and Section 7.)
- **Public dashboard pages (roadmap "phase 4").** The 5.1.0 decision already declined a replacement public status page; no demand evidence since.
- **Local break-glass login.** Roadmap reasoning (SSH plus wrapper API key) still holds for a single trusted operator.
- **Per-feature usage metrics / feature-flag telemetry.** Would answer the open questions below, but adds a data collection and privacy surface for a handful of users. Ask the people instead.
- **Cross-server relay and more locales.** Excluded by the owner; relay is designed, locales are one file plus the parity check.
- **Economy, minigames, automod.** Already on the "Not planned" list.
- **More alert types (for example failed backup, failed scheduled restart).** I did not verify whether these are already covered by existing alerts and audit entries, so I am not recommending them. See open questions.

## 5. Limitations and Open Questions

- **Not examined:** the `minecraft-server-api` wrapper and `minecraft-server-setup` repos, runtime behavior, the test suite, performance, security posture, the dependency tree, the bot's `logWatcher` watchers in detail, and the Docker/CI setup. This is a feature review, not an audit.
- **No usage data.** Whether `/top`, `/leaderboard`, whitelist applications or the Analytics page are used at all is unknown.
- **Questions that would change priorities:**
  - Are whitelist applications actually used? If not, drop FO-002.
  - Is the `/top` alias intentional? If so, drop FO-003.
  - Have you hit a silent failure (backup, scheduled restart, upgrade job) that no alert surfaced? That would produce a real, evidence-based operations recommendation.
  - Do other operators self-host this? That would raise the value of onboarding and docs work beyond FO-001.

## 6. Lessons from leck-eier-bot's memberAudit

Studied (read only): `contracts/memberAudit.d.ts`, `contracts/memberOverview.d.ts`, `src/web/routes/memberAudit.ts`, `src/db/memberRecordsRepository.ts`, `src/services/memberSearch.ts`, the "role-aware dashboard / member overview" design spec, and the September 2026 code and performance reviews that audited it. Not examined: its frontend pages, its tests, and its archive service beyond the review notes.

**What it is.** A Discord bot (guild members, registration forms, events, birthdays) with a dashboard. `member_records` holds one row per Discord user ever seen, upserted from join, leave, rules-accepted and profile events, never deleted by design (later gzip-archived past a cutoff). The Member Audit page lists current members from the live cache plus former members from the DB. A later spec added `GET /members/:userId`, one aggregating endpoint that joins the audit record, registration, birthday and event history by the shared user id, and cross-links from the audit table, birthdays and signup rows. The overview page is read-only; editing stays on each feature's own page.

**What carries over to this project**
- **Aggregate by shared key, read-only, one endpoint.** Directly applicable (FO-004). The spec's reasoning ("three silos keyed by the same id, so the frontend should not make three round trips") matches the minecraft-bot stores exactly.
- **Entry point is the existing list, not a new nav item.** They deliberately expanded the existing page and deferred a separate nav entry. Same advice here: link from Analytics player rows.
- **Empty is not an error.** Sparse members (no birthday, no events) render empty sections; only a person with no footprint at all is a 404. Use the same rule.
- **Shared types as a contract.** Their reviews flagged backend/frontend type duplication and they moved shapes into `contracts/*.d.ts`. This project already has `@mcbot/schema`; put the overview type there from day one.
- **Validate route params.** Their review found unvalidated `request.params as {...}` casts and fixed it with zod schemas. Here, use the existing `schemas.ts` pattern.
- **Name resolution as a separate bulk call.** Their `/members/resolve` maps ids to display names for other pages. The equivalent here is resolving a linked Discord id to a display name through `discordRest.ts`; cache it, and degrade to the raw id when the token is missing.
- **Say what is retained.** Their data is explicit about "null means not tracked". This project's ring buffers need the same honesty.

**Pitfalls they hit, to avoid**
- **Unbounded list queries.** Their top performance finding was `GET /members/audit` doing `SELECT * FROM member_records` plus per-row Unicode transliteration on every request, which blocked the shared event loop (and the Discord heartbeat) as the table grew. They fixed it with SQL-side search and pagination and an archive job. This project's dashboard is a separate process from the bot, so heartbeat risk does not apply, but `loadSessionStore()` loads whole documents; a single-player lookup should read one entry, and any new list must be paged or capped.
- **Fuzzy search is expensive.** They dropped transliteration and fancy-Unicode matching for plain `LIKE`. Do not import `memberSearch.ts`; Minecraft names are ASCII, so plain prefix and substring matching is enough.
- **Unconditional writes on noisy events.** They found a profile `UPDATE` on every `guildMemberUpdate`. If a persistent roster is ever added here, write only on change.
- **Boot-time per-row writes.** Seeding N rows without a transaction. Not relevant unless a roster is built.

**What not to take**
- The persistent per-person table. It makes sense there because Discord provides a stable id and join/leave events. Here the identity key is weaker (lowercased name, sometimes uuid), and a new roster table adds a migration, a writer and a retention policy. Revisit only if rename drift actually hurts after FO-004 ships.
- The Discord member cache, registration flow, birthdays and role-aware community snapshot block. The role-aware idea has a rough analogue in this project's capability model, which already gates by route.
- Former-member archival. There is no "left the server" concept for players.

**On refactoring Analytics.** I would not turn Analytics into a catch-all. It is server-scoped and aggregate (range, charts, leaderboard); a player overview is person-scoped and cross-server. Keep them as siblings, linked row to page. If the owner still wants one combined surface later, the clean seam is a shared "player" route family, not stuffing person data into the analytics routes.

## 7. Conclusion

The product is feature-complete for its stated purpose and audience. Next steps, in order:

1. Do FO-001 (docs refresh) as a standalone commit; it is cheap and removes a real source of confusion.
2. Plan FO-006, FO-005 and FO-004 together as one piece of work (owner-requested). Order inside it: FO-006 first (activity retention constant, then the `player_sessions` table and migration, so data starts accumulating as early as possible); then the player detail endpoint and its type in `@mcbot/schema`; the Players nav page with paged search; then the Analytics rework with names linking into it. The remaining planning input is the owner's choice of retention values.
3. Decide on FO-003 only if the alias is not intentional.
4. Put the engineering effort that is left into the already-designed cross-server relay rather than into new ideas from this review.
