/**
 * RBAC-02/03 — the host-side authorization gate.
 *
 * The dashboard used to gate the whole host-side API with one `requireSysadmin`
 * hook, which made "read the status page" and "restore a backup over the live
 * world" the same grant. That was survivable while the API was start/stop/log;
 * it stops being survivable once the console, backups and the config editor
 * land, and it has no way to express the user this exists for: someone who may
 * tune a mod's spawn rate and nothing else.
 *
 * So authorization moves from the scope to the route. Each host route declares
 * what it needs in Fastify's per-route `config`, and ONE hook on the scope
 * enforces it (fastify.md: cross-cutting concerns are hooks, applied once, not
 * repeated per route).
 *
 *   api.get("/api/servers/:id/log", {
 *     schema: { params: IdParams },
 *     config: { capability: "server:read", scope: "server", param: "id" },
 *   }, handler);
 *
 * The obvious failure mode of moving a gate from a scope to a route is
 * forgetting it on one route, which turns a silent hole into a 200. That is
 * closed by `assertCapabilitiesDeclared`: an onRoute hook that throws at boot
 * if a route in the host scope carries no rule. A crash on startup beats a
 * code review.
 *
 * The gate runs at `onRequest`, keeping the ordering the sysadmin gate always
 * had: routing has happened (so `req.params` is populated) but the body has
 * not been parsed or validated, so an unauthorized caller gets 401/403 and
 * never a 400 that would confirm the route's body shape to a stranger.
 *
 * What this is NOT: a boundary against anyone holding the wrapper's API key or
 * a shell on the Minecraft host. The wrapper has one key and no concept of a
 * user. This is a boundary between dashboard users; the capability floor
 * (SCRIPT_MAP, SAFE_ARG, path containment) lives in the wrapper.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { loadConfig } from "@mcbot/core/config.js";
import {
  ALL_SERVERS,
  GRANTABLE_CAPABILITIES,
  isCapability,
  resolveCapabilities,
  type Capability,
  type CapabilityGrants,
  type GrantableCapability,
} from "@mcbot/schema/capabilities.js";
import { Unauthorized, Forbidden } from "../errors.js";
import { isSysadmin, sessionFromRequest, type Session } from "./auth.js";

/**
 * How a route's capability is checked.
 *
 * `scope` is mandatory and has no default: the three modes differ in who they
 * let through, and picking one by inference is how a fleet-wide route quietly
 * accepts a single-server grant.
 *
 *   server  the route acts on one server, named by `param`. Checked against
 *           that server's grants plus the wildcard block.
 *   global  the route is fleet-wide (the audit log, config.json). Checked
 *           against the wildcard block only.
 *   any     the route returns a per-server collection and the HANDLER filters
 *           it. Passing here only proves the caller may see something; it is
 *           the handler's job to decide what. Use `visibleServerIds`.
 */
export type CapabilityRule =
  | { capability: Capability; scope: "server"; param: string }
  | { capability: Capability; scope: "global" }
  | { capability: Capability; scope: "any" };

declare module "fastify" {
  interface FastifyContextConfig {
    /** Set by every host-side route; asserted at boot. */
    capability?: Capability;
    scope?: CapabilityRule["scope"];
    /** Params key holding the server id, for `scope: "server"`. */
    param?: string;
  }
}

/** Every grantable capability, the set a sysadmin implicitly holds. */
const ALL_GRANTABLE: ReadonlySet<GrantableCapability> = new Set(
  GRANTABLE_CAPABILITIES,
);

function grants(): CapabilityGrants | undefined {
  // Read per call rather than cached: grants live in config.json, so they can
  // be re-derived on every request instead of being captured at login the way
  // guild scope has to be (SEC-03). Revoking someone takes effect on their
  // next request, not in two hours.
  return loadConfig().webui?.grants;
}

/**
 * The capabilities a session holds, on one server or fleet-wide.
 *
 * Sysadmins short-circuit to everything: a top-level `adminUsers` entry is
 * already full host access by definition, and re-deriving it per request is
 * what keeps removing a sysadmin immediate.
 */
export function sessionCapabilities(
  session: Session,
  serverId?: string,
): ReadonlySet<GrantableCapability> {
  if (isSysadmin(session)) return ALL_GRANTABLE;
  return resolveCapabilities(grants(), session.uid, serverId);
}

/** Does this session hold `capability`, under the rule's lookup mode? */
function sessionHolds(
  session: Session,
  capability: Capability,
  serverId?: string,
): boolean {
  if (isSysadmin(session)) return true;
  // A non-grantable capability (bot:config) is reachable only by the
  // short-circuit above; everyone else is denied regardless of the file.
  if (!(ALL_GRANTABLE as ReadonlySet<string>).has(capability)) return false;
  return resolveCapabilities(grants(), session.uid, serverId).has(
    capability as GrantableCapability,
  );
}

/**
 * The subset of `serverIds` this session may read, for `scope: "any"` routes
 * that return a collection.
 *
 * This is the server-side half of the rule that a client receives only what it
 * may display: a route that returns every server's status must filter here,
 * not hide rows in the UI.
 */
export function visibleServerIds(
  session: Session,
  serverIds: readonly string[],
  capability: Capability = "server:read",
): string[] {
  if (isSysadmin(session)) return [...serverIds];
  return serverIds.filter((id) => sessionHolds(session, capability, id));
}

/** Resolve the server id a `scope: "server"` rule points at. */
function serverIdFromParams(req: FastifyRequest, param: string): string | null {
  const params = req.params;
  if (typeof params !== "object" || params === null) return null;
  const value = (params as Record<string, unknown>)[param];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ruleFromRequest(req: FastifyRequest): CapabilityRule | null {
  const cfg = req.routeOptions.config;
  const { capability, scope, param } = cfg;
  if (!capability || !scope) return null;
  if (scope === "server") {
    return param ? { capability, scope, param } : null;
  }
  return { capability, scope };
}

/**
 * The one host-scope `onRequest` hook: session, then capability.
 *
 * Failures are thrown rather than written with `reply.code().send()` so the
 * central error handler renders them in the one consistent body
 * (backend-apis.md: one error handler over typed failures).
 */
export async function capabilityGate(req: FastifyRequest): Promise<void> {
  const session = sessionFromRequest(req);
  if (!session) {
    throw new Unauthorized(
      "You're not signed in. Log in with Discord to continue.",
    );
  }

  const rule = ruleFromRequest(req);
  if (!rule) {
    // Unreachable in a booted process: assertCapabilitiesDeclared refuses to
    // start without a rule. Kept as a runtime deny so a route added through
    // some path the assertion doesn't see fails closed rather than open.
    throw new Forbidden("This route has no capability rule.");
  }

  if (rule.scope === "server") {
    const serverId = serverIdFromParams(req, rule.param);
    if (serverId === null) {
      throw new Forbidden("This route requires a server.");
    }
    if (!sessionHolds(session, rule.capability, serverId)) {
      throw new Forbidden(deniedMessage(rule.capability, serverId));
    }
    return;
  }

  // "global" and "any" both check the wildcard block; "any" additionally lets
  // a per-server grantee through, because the handler filters afterwards.
  if (rule.scope === "any") {
    if (!isSysadmin(session) && !holdsAnywhere(session, rule.capability)) {
      throw new Forbidden(deniedMessage(rule.capability));
    }
    return;
  }

  if (!sessionHolds(session, rule.capability)) {
    throw new Forbidden(deniedMessage(rule.capability));
  }
}

/** Does the session hold `capability` on the wildcard block or any server? */
function holdsAnywhere(session: Session, capability: Capability): boolean {
  const perUser = grants()?.[session.uid];
  if (!perUser) return false;
  for (const serverId of Object.keys(perUser)) {
    if (
      sessionHolds(
        session,
        capability,
        serverId === ALL_SERVERS ? undefined : serverId,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A denial names the capability and never the reason it was checked: telling a
 * caller which server exists is a disclosure they were just refused.
 */
function deniedMessage(capability: Capability, serverId?: string): string {
  return serverId
    ? `You don't have "${capability}" on this server.`
    : `You don't have "${capability}".`;
}

/**
 * RBAC-03 — refuse to boot if a host-scope route declares no capability.
 *
 * Register this inside the host scope, before the routes. Fastify fires
 * `onRoute` synchronously as each route registers, so a missing rule throws
 * during `buildServer()` and the process never starts serving it.
 */
export function assertCapabilitiesDeclared(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    // The HEAD Fastify auto-generates for every GET inherits that route's
    // config, so it passes or fails with its GET and needs no special case.
    const { capability, scope, param } = route.config ?? {};
    const where = `${String(route.method)} ${route.url}`;

    if (!capability) {
      throw new Error(
        `Host route ${where} declares no capability. Add ` +
          `config: { capability: "…", scope: "server" | "global" | "any" } ` +
          `to its route options (see auth/capabilities.ts).`,
      );
    }
    if (!isCapability(capability)) {
      throw new Error(
        `Host route ${where} declares unknown capability "${capability}".`,
      );
    }
    if (scope !== "server" && scope !== "global" && scope !== "any") {
      throw new Error(
        `Host route ${where} declares capability "${capability}" with no ` +
          `scope. Pick "server", "global" or "any" explicitly.`,
      );
    }
    if (scope === "server" && !param) {
      throw new Error(
        `Host route ${where} is server-scoped but names no param. Add ` +
          `param: "id" (or whichever params key holds the server id).`,
      );
    }
    if (scope === "server" && param && !route.url.includes(`:${param}`)) {
      throw new Error(
        `Host route ${where} is server-scoped on param "${param}", which is ` +
          `not in its path. The gate would deny every request.`,
      );
    }
  });
}

/**
 * The caller's capabilities per server, for `/api/me`.
 *
 * The frontend renders from this rather than probing for 403s: someone with
 * only `config:read`/`config:write` on one server should never see a Servers
 * tab whose buttons all fail (DSH-05).
 */
export function capabilityMap(
  session: Session,
  serverIds: readonly string[],
): Record<string, GrantableCapability[]> {
  const out: Record<string, GrantableCapability[]> = {};
  for (const id of serverIds) {
    const caps = [...sessionCapabilities(session, id)];
    if (caps.length > 0) out[id] = caps;
  }
  const global = [...sessionCapabilities(session)];
  if (global.length > 0) out[ALL_SERVERS] = global;
  return out;
}
