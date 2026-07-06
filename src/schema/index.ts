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
export type * from "./stats.js";
export type * from "./contract.js";
