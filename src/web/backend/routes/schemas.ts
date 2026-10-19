/**
 * Route contracts — one TypeBox definition per shape, consumed by every
 * route via the Fastify TypeBox type provider (fastify.md: "define the shape
 * once, get validation + serialization + typing from it").
 *
 * Attaching one of these as a route's `schema` does three things from a single
 * source: Fastify validates the request at the boundary (a malformed body is a
 * 400 before the handler runs), the response is serialized from the compiled
 * schema (so a route can't leak a field the schema doesn't list), and the
 * handler's `request.params/query/body` are typed — no `as` cast at the edge,
 * which is exactly the "don't force-cast parsed input" rule from
 * types-and-contracts.md.
 *
 * What is NOT schematised here: the *contents* of a config write body. The
 * config object is schema-driven and validated in depth by
 * configService.validateCandidate against the generated JSON Schema — the one
 * place that knows the full shape. So the body schema below only asserts the
 * envelope ("an object with a string baseHash and an object config"); the deep
 * validation stays where it belongs.
 */
import { Type, type Static } from "@sinclair/typebox";
import { MAX_CONSOLE_COMMAND_LENGTH } from "@mcbot/schema/consoleCommands.js";

/** An arbitrary JSON object whose contents are validated elsewhere. Rejects
 *  non-objects (a null / array / scalar body) at the boundary; the deep check
 *  is configService.validateCandidate. */
const AnyObject = Type.Object({}, { additionalProperties: true });

/** Ids are 22 base64url chars, produced by the wrapper's index (config files, backup archives). */
export const FILE_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** A stored prune plan id. */
const PLAN_ID_PATTERN = "^[a-f0-9]{16}$";

/** A wrapper job id (a UUID). */
const JOB_ID_PATTERN = "^[a-f0-9-]{36}$";

// ── Params ──────────────────────────────────────────────────────────────────

export const ServerIdParams = Type.Object({ serverId: Type.String() });
export type ServerIdParams = Static<typeof ServerIdParams>;

export const IdParams = Type.Object({ id: Type.String() });
export type IdParams = Static<typeof IdParams>;

/** A server plus one of its config files, addressed by opaque id. */
export const ConfigFileParams = Type.Object({
  id: Type.String(),
  fileId: Type.String(),
});
export type ConfigFileParams = Static<typeof ConfigFileParams>;

/**
 * The route to one value inside a config file. An empty path addresses a
 * document that is itself the value (a JSON file holding a bare array), and a
 * segment may be empty because JSON allows an empty key.
 */
const ConfigKeyPath = Type.Array(Type.String({ maxLength: 512 }), {
  minItems: 0,
  maxItems: 32,
});

/** Whether the response should carry the raw file text. */
export const ConfigReadQuery = Type.Object({
  text: Type.Optional(Type.String()),
});
export type ConfigReadQuery = Static<typeof ConfigReadQuery>;

/**
 * The values that changed, not the document.
 *
 * The client never posts a whole file: the server re-reads the current text
 * and splices these in, so the writer's guards stay meaningful.
 */
export const ConfigEditBody = Type.Object({
  path: ConfigKeyPath,
  value: Type.Unknown(),
});
export type ConfigEditBody = Static<typeof ConfigEditBody>;

export const ModConfigWriteBody = Type.Object({
  etag: Type.String({ minLength: 1 }),
  edits: Type.Array(ConfigEditBody, { minItems: 1, maxItems: 500 }),
});
export type ModConfigWriteBody = Static<typeof ModConfigWriteBody>;

export const ModConfigRevertBody = Type.Object({
  snapshot: Type.String({ minLength: 1, maxLength: 64 }),
  /** The version on screen when the revert was asked for; a newer file is a conflict. */
  etag: Type.String({ minLength: 1 }),
});
export type ModConfigRevertBody = Static<typeof ModConfigRevertBody>;

/**
 * Resolving one conflicted queued edit.
 *
 * `currentValue` is echoed back by the client rather than re-read here on
 * purpose: it is the value the operator was actually shown when they chose.
 * Re-reading would rebase onto a value they never saw if the file changed
 * again between the preview and the click.
 */
export const QueueResolveBody = Type.Object({
  fileId: Type.String({ minLength: 1, maxLength: 64 }),
  keyPath: ConfigKeyPath,
  choice: Type.Union([Type.Literal("queued"), Type.Literal("current")]),
  currentValue: Type.Optional(Type.Unknown()),
});
export type QueueResolveBody = Static<typeof QueueResolveBody>;

/** Which stat a leaderboard ranks by. Validated against the catalogue. */
export const LeaderboardQuery = Type.Object({
  stat: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  /** Omitted means all-time; otherwise the board covers this many hours. */
  hours: Type.Optional(Type.String()),
});
export type LeaderboardQuery = Static<typeof LeaderboardQuery>;

/** How far back an analytics panel looks, in hours. Clamped in the route handler. */
export const AnalyticsRangeQuery = Type.Object({
  hours: Type.Optional(Type.String()),
});
export type AnalyticsRangeQuery = Static<typeof AnalyticsRangeQuery>;

/** A server plus one of its backup archives, addressed by opaque id. */
export const BackupFileParams = Type.Object({
  id: Type.String(),
  fileId: Type.String(),
});
export type BackupFileParams = Static<typeof BackupFileParams>;

export const ServerActionParams = Type.Object({
  id: Type.String(),
  action: Type.String(),
});
export type ServerActionParams = Static<typeof ServerActionParams>;

// ── Query ───────────────────────────────────────────────────────────────────
// Numeric limits stay strings here and are parsed + clamped in the handler:
// the clamp ([1, N]) is a domain rule, not input shape, so it lives with the
// handler rather than in the schema.

export const LimitQuery = Type.Object({ limit: Type.Optional(Type.String()) });
export type LimitQuery = Static<typeof LimitQuery>;

export const LinesQuery = Type.Object({ lines: Type.Optional(Type.String()) });
export type LinesQuery = Static<typeof LinesQuery>;

export const BackupIndexQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
});
export type BackupIndexQuery = Static<typeof BackupIndexQuery>;

export const DryRunQuery = Type.Object({ dryRun: Type.Optional(Type.String()) });
export type DryRunQuery = Static<typeof DryRunQuery>;

export const OAuthCallbackQuery = Type.Object({
  code: Type.Optional(Type.String()),
  state: Type.Optional(Type.String()),
});
export type OAuthCallbackQuery = Static<typeof OAuthCallbackQuery>;

// ── Bodies ──────────────────────────────────────────────────────────────────

export const ConfigWriteBody = Type.Object({
  baseHash: Type.String(),
  config: AnyObject,
});
export type ConfigWriteBody = Static<typeof ConfigWriteBody>;

/** A console command. The length ceiling is a transport limit and belongs in
 *  the schema; the deny-list is a policy decision and lives in the handler. */
export const ConsoleCommandBody = Type.Object({
  command: Type.String({ minLength: 1, maxLength: MAX_CONSOLE_COMMAND_LENGTH }),
});
export type ConsoleCommandBody = Static<typeof ConsoleCommandBody>;

export const GuildConfigWriteBody = Type.Object({
  baseHash: Type.String(),
  guildConfig: AnyObject,
});
export type GuildConfigWriteBody = Static<typeof GuildConfigWriteBody>;

// ── Responses ─────────────────────────────────────────────────────────────
// Only stable, fixed-shape payloads get a response schema (config/guild writes
// and rollbacks). The read endpoints return schema-driven config, live status,
// or upstream-shaped lists whose fields are already narrowed at the domain/
// safeConfig layer; pinning a tight response schema there would risk silently
// stripping a field, so those are serialized as-is by intent.

/** The shared result of a config mutation: whether it applied, plus any
 *  non-fatal validation warnings surfaced to the editor. */
export const MutationResult = Type.Object({
  ok: Type.Boolean(),
  changed: Type.Boolean(),
  warnings: Type.Array(Type.String()),
});
export type MutationResult = Static<typeof MutationResult>;

// ── Mods tab (install / update / remove + Modrinth browse) ──────────────────

/** The wrapper's own slug rule: starts with a letter or digit, so never `.` or `..` (AUD-024). */
const MOD_SLUG_PATTERN = "^[a-zA-Z0-9][\\w.!@$()+'\"`-]{0,95}$";

/** A dimension id, never a bare `.` or `..` path segment (AUD-024). */
const DIMENSION_PATTERN = "^(?!\\.{1,2}$)[a-z0-9_.:-]{1,64}$";
export const ModSlugParams = Type.Object({
  id: Type.String(),
  slug: Type.String({ minLength: 1, maxLength: 96, pattern: MOD_SLUG_PATTERN }),
});
export type ModSlugParams = Static<typeof ModSlugParams>;

export const ModAddBody = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 96, pattern: MOD_SLUG_PATTERN }),
  mcVersion: Type.Optional(Type.String({ maxLength: 20 })),
  modLoader: Type.Optional(Type.String({ maxLength: 20 })),
  versionId: Type.Optional(Type.String({ maxLength: 32 })),
});
export type ModAddBody = Static<typeof ModAddBody>;

export const ModUpdatesBody = Type.Object({
  mcVersion: Type.Optional(Type.String({ maxLength: 20 })),
});
export type ModUpdatesBody = Static<typeof ModUpdatesBody>;

export const ModSearchQuery = Type.Object({
  query: Type.Optional(Type.String({ maxLength: 120 })),
  limit: Type.Optional(Type.String()),
  offset: Type.Optional(Type.String()),
  sort: Type.Optional(Type.String({ maxLength: 20 })),
  categories: Type.Optional(Type.String({ maxLength: 200 })),
  compatible: Type.Optional(Type.String()),
  hideClientOnly: Type.Optional(Type.String()),
});
export type ModSearchQuery = Static<typeof ModSearchQuery>;

export const ModIconQuery = Type.Object({ url: Type.String({ maxLength: 512 }) });
export type ModIconQuery = Static<typeof ModIconQuery>;

/** Same shape the wrapper accepts for a Minecraft version (letters, digits, `.`, `_`, `-`). */
const MC_VERSION_PATTERN = "^[A-Za-z0-9_.-]{1,20}$";

export const ModCompatBody = Type.Object({
  mcVersion: Type.String({ pattern: MC_VERSION_PATTERN, maxLength: 20 }),
  refresh: Type.Optional(Type.Boolean()),
});
export type ModCompatBody = Static<typeof ModCompatBody>;

export const ModCompatJobParams = Type.Object({
  id: Type.String(),
  jobId: Type.String({ pattern: JOB_ID_PATTERN }),
});
export type ModCompatJobParams = Static<typeof ModCompatJobParams>;

export const UpgradeStartBody = Type.Object({
  mcVersion: Type.String({ pattern: MC_VERSION_PATTERN, maxLength: 20 }),
  /** The mods the shown compatibility check reported as unavailable. */
  expectUnavailable: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { maxItems: 500 }),
  ),
  countdownSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 600 })),
  /** A stored prune plan to apply after the install, before the first start. */
  prunePlan: Type.Optional(Type.String({ pattern: PLAN_ID_PATTERN })),
});
export type UpgradeStartBody = Static<typeof UpgradeStartBody>;

const PruneZoneBody = Type.Object({
  name: Type.String({ maxLength: 64 }),
  dimension: Type.String({ pattern: DIMENSION_PATTERN }),
  x1: Type.Integer({ minimum: -2_000_000, maximum: 2_000_000 }),
  z1: Type.Integer({ minimum: -2_000_000, maximum: 2_000_000 }),
  x2: Type.Integer({ minimum: -2_000_000, maximum: 2_000_000 }),
  z2: Type.Integer({ minimum: -2_000_000, maximum: 2_000_000 }),
});

/** Every field optional: what is missing comes from the saved settings or the defaults. */
export const PruneParamsBody = Type.Object({
  thresholdMinutes: Type.Optional(Type.Number({ minimum: 0, maximum: 1_000_000 })),
  spawnRadiusChunks: Type.Optional(Type.Integer({ minimum: 0, maximum: 512 })),
  playerRadiusChunks: Type.Optional(Type.Integer({ minimum: 0, maximum: 512 })),
  bufferChunks: Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })),
  zones: Type.Optional(Type.Array(PruneZoneBody, { maxItems: 100 })),
  dimensions: Type.Optional(
    Type.Union([
      Type.Null(),
      Type.Array(Type.String({ pattern: DIMENSION_PATTERN }), { maxItems: 32 }),
    ]),
  ),
});
export type PruneParamsBody = Static<typeof PruneParamsBody>;

export const PruneApplyBody = Type.Object({
  planId: Type.String({ pattern: PLAN_ID_PATTERN }),
  countdownSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 600 })),
});
export type PruneApplyBody = Static<typeof PruneApplyBody>;

export const PruneScanParams = Type.Object({
  id: Type.String(),
  jobId: Type.String({ pattern: JOB_ID_PATTERN }),
});

export const PruneMapParams = Type.Object({
  id: Type.String(),
  planId: Type.String({ pattern: PLAN_ID_PATTERN }),
  index: Type.String({ pattern: "^\\d{1,3}$" }),
});

export const PruneChunkQuery = Type.Object({
  dimension: Type.String({ pattern: DIMENSION_PATTERN }),
  cx: Type.Integer({ minimum: -2_000_000, maximum: 2_000_000 }),
  cz: Type.Integer({ minimum: -2_000_000, maximum: 2_000_000 }),
});

export const PruneTileParams = Type.Object({
  id: Type.String(),
  dimension: Type.String({ pattern: DIMENSION_PATTERN }),
  rx: Type.Integer({ minimum: -100_000, maximum: 100_000 }),
  rz: Type.Integer({ minimum: -100_000, maximum: 100_000 }),
});

export const PrunePlanParams = Type.Object({
  id: Type.String(),
  planId: Type.String({ pattern: PLAN_ID_PATTERN }),
});

export const UpgradeJobParams = Type.Object({
  id: Type.String(),
  jobId: Type.String({ pattern: JOB_ID_PATTERN }),
});
export type UpgradeJobParams = Static<typeof UpgradeJobParams>;

export const UpgradePollQuery = Type.Object({
  since: Type.Optional(Type.String({ pattern: "^\\d{1,12}$" })),
});
export type UpgradePollQuery = Static<typeof UpgradePollQuery>;

export const ModUpdatesQuery = Type.Object({
  refresh: Type.Optional(Type.String()),
});
export type ModUpdatesQuery = Static<typeof ModUpdatesQuery>;

// ── Daily rewards ───────────────────────────────────────────────────────────

/** A reward document save. The pool's contents are checked by parseRewardPool
 *  (@mcbot/schema/dailyRewards.ts), the validator the bot loads it with. */
export const RewardsWriteBody = Type.Object({
  baseHash: Type.String({ maxLength: 128 }),
  pool: AnyObject,
});
export type RewardsWriteBody = Static<typeof RewardsWriteBody>;
