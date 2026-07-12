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

/** An arbitrary JSON object whose contents are validated elsewhere. Rejects
 *  non-objects (a null / array / scalar body) at the boundary; the deep check
 *  is configService.validateCandidate. */
const AnyObject = Type.Object({}, { additionalProperties: true });

// ── Params ──────────────────────────────────────────────────────────────────

export const ServerIdParams = Type.Object({ serverId: Type.String() });
export type ServerIdParams = Static<typeof ServerIdParams>;

export const IdParams = Type.Object({ id: Type.String() });
export type IdParams = Static<typeof IdParams>;

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
