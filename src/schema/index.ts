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
export * from "./serverActions.js";
