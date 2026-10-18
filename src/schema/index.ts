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
// The runtime values in config.ts: the fields that configured local mode
// before 5.0.0 (so the validator can point a 4.x config at the migration),
// the guild feature list, and which config paths hold secrets.
export {
  REMOVED_LOCAL_SERVER_FIELDS,
  GUILD_FEATURE_KEYS,
  SECRET_PLACEHOLDER,
  SECRET_SERVER_KEYS,
  isSecretConfigPath,
} from "./config.js";
export type * from "./contract.js";
// The wrapper's wire contract: types generated from its OpenAPI document,
// plus the names the bot and dashboard use for them.
export type {
  WireSchemas,
  ScriptResult,
  ConfigFileInfo,
  InstalledMod,
  InstalledMods,
  ModToggleResult,
  ModAddResult,
  ModRemoveResult,
  ModUpdateCheck,
  ModApplyResult,
  ModCompatJob,
  ModCompatMod,
  ModCompatStarted,
  UpgradeJob,
  UpgradeRequest,
  UpgradeStarted,
  UpgradeEvent,
  UpgradeResult,
  PruneParams,
  PruneParamsRequest,
  PruneZone,
  PruneSummary,
  PruneDimensionSummary,
  PruneScanJob,
  PruneMap,
  BackupDeleteResult,
  RemoteHostInfo,
} from "./wire/index.js";
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
// Millisecond unit lengths (MS), shared by core duration parsing and the dashboard.
export * from "./time.js";
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
export * from "./commandOutcome.js";
// Analytics DTOs plus the per-section retention ceilings (ANALYTICS_CAP_HOURS),
// shared by the route that clamps and the view that labels.
export * from "./analytics.js";

// Stable error codes shared by the backend error handler and the frontend ApiError.
export * from "./apiErrors.js";

export * from "./configStatus.js";

// Runtime values (the status roles with their shapes and colours, and the
// shared glossary), read by the dashboard's chips and the bot's embed colours.
export * from "./status.js";
export * from "./glossary.js";
