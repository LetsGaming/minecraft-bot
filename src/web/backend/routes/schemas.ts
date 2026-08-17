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
 * The values that changed, not the document.
 *
 * The client never posts a whole file: the server re-reads the current text
 * and splices these in, so the writer's guards stay meaningful.
 */
export const ModConfigWriteBody = Type.Object({
  etag: Type.String({ minLength: 1 }),
  edits: Type.Array(
    Type.Object({
      path: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 }),
      value: Type.Unknown(),
    }),
    { minItems: 1, maxItems: 500 },
  ),
});
export type ModConfigWriteBody = Static<typeof ModConfigWriteBody>;

export const ModConfigRevertBody = Type.Object({
  snapshot: Type.String({ minLength: 1, maxLength: 64 }),
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
  keyPath: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 }),
  choice: Type.Union([Type.Literal("queued"), Type.Literal("current")]),
  currentValue: Type.Optional(Type.Unknown()),
});
export type QueueResolveBody = Static<typeof QueueResolveBody>;

/** Which stat a leaderboard ranks by. Validated against the catalogue. */
export const LeaderboardQuery = Type.Object({
  stat: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export type LeaderboardQuery = Static<typeof LeaderboardQuery>;

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
export const ModSlugParams = Type.Object({
  id: Type.String(),
  slug: Type.String({ minLength: 1, maxLength: 96 }),
});
export type ModSlugParams = Static<typeof ModSlugParams>;

export const ModAddBody = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 96 }),
  mcVersion: Type.Optional(Type.String({ maxLength: 20 })),
  modLoader: Type.Optional(Type.String({ maxLength: 20 })),
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

export const ModUpdatesQuery = Type.Object({
  refresh: Type.Optional(Type.String()),
});
export type ModUpdatesQuery = Static<typeof ModUpdatesQuery>;
