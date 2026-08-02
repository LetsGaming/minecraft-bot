/**
 * @mcbot/schema — isomorphic contracts shared by the bot, the web-ui
 * backend, and the browser frontend.
 *
 *   config.ts    RawBotConfig and every config sub-shape (the source the
 *                JSON Schema is generated from — scripts/generate-schema.mjs)
 *   stats.ts     stat/leaderboard shapes referenced by the config types
 *   contract.ts  web API request/response DTOs
 *
 * Rule: nothing in this package may import Node built-ins or any
 * runtime-only dependency — the frontend bundles it.
 */
export type * from "./config.js";
// One runtime value lives in config.ts: the list of fields that configured
// local mode before 5.0.0, so the validator can recognise a 4.x config and
// point at the migration instead of reporting a bare "apiUrl is required".
export { REMOVED_LOCAL_SERVER_FIELDS } from "./config.js";
export type * from "./contract.js";
// Runtime values (the leaderboard-interval contract) alongside the stat
// shapes, so the scheduler and the snapshot retention policy size periods
// from one definition — hence a value re-export rather than `export type *`.
export * from "./stats.js";
// Runtime values (the notification-event contract), so the dispatcher, the
// setup wizard, and the validator import one shared definition — hence a
// value re-export rather than `export type *`.
export * from "./notifications.js";
export * from "./commandOptions.js";
export * from "./discord.js";
// Runtime values (formatBytes), shared by the bot embeds and the dashboard —
// the two had drifting copies before.
export * from "./format.js";
export * from "./serverActions.js";
// Runtime values (the capability contract), shared by the dashboard's route
// declarations, its authorization gate, and the frontend that renders from
// /api/me — one definition rather than three sets of literals.
export * from "./capabilities.js";
// Runtime values (the console deny-list contract), so the route that enforces
// it and the editor that greys a command out share one matching rule.
export * from "./consoleCommands.js";
// Runtime values (the ServerState / RconState contract), shared by the bot's
// status paths, the web backend, and the Vue frontend — a value re-export so
// all three switch on one definition rather than three sets of literals.
export * from "./serverState.js";
