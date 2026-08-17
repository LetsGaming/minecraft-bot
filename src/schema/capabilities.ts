// ── Dashboard capabilities ──────────────────────────────────────────────────
// What a dashboard user may do to a Minecraft host, named once for every layer
// that reasons about it: the route declarations, the onRequest gate, the
// /api/me payload the frontend renders from, and the config schema that stores
// the grants.
//
// Why capabilities and not a role ladder: these actions don't form a line.
// Someone editing mod configs is not "less than" someone who restarts the
// server, they are doing a different job. The axis that matters is blast
// radius and reversibility, and a ladder can't express "may tune spawn rates,
// may not download the world".
//
// The set is deliberately small and closed. A new one is a schema change plus
// a regenerated config.schema.json, which is the point: adding host-side reach
// should be visible in a diff.

/**
 * Capabilities an operator can hand out through `webui.grants`.
 *
 * Grouped by blast radius in the order below, which is also the order the
 * grants editor renders them:
 *   read        server:read, audit:read
 *   reversible  server:control, backup:create, config:read
 *   sensitive   server:console, backup:download, config:write
 *   irreversible backup:restore, server:rollback
 *
 * `server:console` sits above `server:control` on purpose. One console command
 * can op an account, ban a player or run a worldedit operation; a restart
 * cannot. It feels smaller than a restart and is larger.
 */
export const GRANTABLE_CAPABILITIES = [
  "server:read",
  "audit:read",
  "server:control",
  "backup:create",
  "config:read",
  "server:console",
  "backup:download",
  "config:write",
  "mods:read",
  "mods:write",
  "backup:restore",
  "server:rollback",
] as const;

/**
 * Capabilities that exist only so a route can declare what it needs, and can
 * never appear in a grant. `bot:config` reads and writes config.json, which
 * carries the Discord token and every RCON password: it is sysadmin by
 * definition, not by assignment. `resolveCapabilities` drops these if they
 * somehow appear in a grant block.
 */
export const SYSADMIN_ONLY_CAPABILITIES = ["bot:config"] as const;

export const CAPABILITIES = [
  ...GRANTABLE_CAPABILITIES,
  ...SYSADMIN_ONLY_CAPABILITIES,
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type GrantableCapability = (typeof GRANTABLE_CAPABILITIES)[number];

/**
 * Capabilities whose effect cannot be undone from the dashboard. Both
 * front-ends require a typed confirmation (the server's name, not an OK
 * button) before invoking one — the same reason DISRUPTIVE_SERVER_ACTIONS
 * exists in serverActions.ts, one step further along.
 */
export const IRREVERSIBLE_CAPABILITIES = [
  "backup:restore",
  "server:rollback",
] as const satisfies readonly Capability[];

/** The wildcard server key in a grant block: every configured server. */
export const ALL_SERVERS = "*";

/**
 * Grants, as stored under `webui.grants` in config.json.
 *
 * Shape: Discord user ID → server id (or `"*"`) → capabilities.
 *
 * ```jsonc
 * {
 *   "123456789012345678": { "survival": ["config:read", "config:write"] },
 *   "234567890123456789": { "*": ["server:read", "server:control"] }
 * }
 * ```
 *
 * Grants live in config.json rather than the database so they inherit the
 * "config.json is the shared source of truth" contract: the fs watcher picks
 * a change up live, and the schema-driven editor renders them for free.
 * Editing them therefore needs `bot:config`, so only a sysadmin can escalate
 * anyone, including themselves. That self-reference is intended.
 */
export type CapabilityGrants = Record<
  string,
  Record<string, GrantableCapability[]>
>;

const GRANTABLE = new Set<string>(GRANTABLE_CAPABILITIES);

/** Type guard: is this string a capability a route may declare? */
export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Type guard: may this capability appear in a grant block? */
export function isGrantableCapability(
  value: string,
): value is GrantableCapability {
  return GRANTABLE.has(value);
}

/**
 * The capabilities `userId` holds, either on one server or globally.
 *
 * Two lookup modes, and the difference is a security decision rather than a
 * convenience:
 *
 *   - `serverId` given  → the union of the `"*"` block and that server's block.
 *   - `serverId` omitted → the `"*"` block only.
 *
 * The second mode is what routes that aren't server-scoped use (the audit log
 * is fleet-wide, so reading it is a fleet-wide grant). Falling back to "has it
 * on any server" there would quietly turn a single-server grant into
 * cross-server disclosure, so it is not offered.
 *
 * Sysadmins are not handled here: this module stays pure and knows nothing
 * about config loading or sessions. The web layer short-circuits them.
 */
export function resolveCapabilities(
  grants: CapabilityGrants | undefined,
  userId: string,
  serverId?: string,
): Set<GrantableCapability> {
  const out = new Set<GrantableCapability>();
  const perUser = grants?.[userId];
  if (!perUser) return out;

  const blocks = [perUser[ALL_SERVERS]];
  if (serverId !== undefined && serverId !== ALL_SERVERS) {
    blocks.push(perUser[serverId]);
  }

  for (const block of blocks) {
    if (!Array.isArray(block)) continue;
    for (const entry of block) {
      // Grants come from a hand-editable file. An unknown or non-grantable
      // string is dropped rather than trusted: a typo must not become a
      // capability, and `bot:config` must not become assignable by writing it
      // into the file by hand.
      if (typeof entry === "string" && isGrantableCapability(entry)) {
        out.add(entry);
      }
    }
  }
  return out;
}

/**
 * Does `userId` hold `capability`, under the lookup rules above?
 *
 * A capability that can never be granted is always false here — the web layer
 * grants it to sysadmins by short-circuiting before this is reached.
 */
export function hasCapability(
  grants: CapabilityGrants | undefined,
  userId: string,
  capability: Capability,
  serverId?: string,
): boolean {
  if (!isGrantableCapability(capability)) return false;
  return resolveCapabilities(grants, userId, serverId).has(capability);
}

/**
 * Every server id named in a user's grants, excluding the wildcard.
 *
 * The frontend uses this to decide which servers to offer someone who is not a
 * sysadmin; `"*"` holders are resolved against the configured server list by
 * the caller, which is the only side that knows it.
 */
export function grantedServerIds(
  grants: CapabilityGrants | undefined,
  userId: string,
): string[] {
  const perUser = grants?.[userId];
  if (!perUser) return [];
  return Object.keys(perUser).filter((id) => id !== ALL_SERVERS);
}

/** Does this user hold the wildcard block? */
export function hasWildcardGrant(
  grants: CapabilityGrants | undefined,
  userId: string,
): boolean {
  return Array.isArray(grants?.[userId]?.[ALL_SERVERS]);
}
