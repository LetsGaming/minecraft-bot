import { computed, ref } from "vue";
import { ALL_SERVERS, type GrantableCapability } from "../api";

/**
 * DSH-05 — what the signed-in user may do, as the views render from.
 *
 * The rule this exists to enforce: a view decides what to show from the
 * caller's capabilities, never by rendering everything and letting the
 * buttons 403 on click. Someone holding only `config:read`/`config:write` on
 * one server should see the config editor for that server and no Servers tab
 * at all, rather than a page of controls that all fail.
 *
 * Module-level state, like useGuilds: the map arrives once with /api/me and is
 * read by several views, so it is a session-lived singleton rather than
 * per-component state. `setCapabilities` is called by whoever loads /api/me;
 * this composable deliberately does not fetch, so there is one owner of that
 * request.
 *
 * Not a security boundary. The gate is the backend's onRequest hook
 * (auth/capabilities.ts); this only decides what to draw.
 */

const capabilities = ref<Record<string, GrantableCapability[]>>({});

/** Populate from an /api/me response. */
export function setCapabilities(
  map: Record<string, GrantableCapability[]> | undefined,
): void {
  capabilities.value = map ?? {};
}

function held(serverId: string | undefined): Set<GrantableCapability> {
  const out = new Set<GrantableCapability>(capabilities.value[ALL_SERVERS]);
  if (serverId !== undefined && serverId !== ALL_SERVERS) {
    for (const cap of capabilities.value[serverId] ?? []) out.add(cap);
  }
  return out;
}

export function useCapabilities() {
  /**
   * Does the user hold `capability`?
   *
   * Mirrors the backend's lookup rules exactly, including the strict one: with
   * no `serverId` this asks about the fleet-wide grant only, so a per-server
   * grantee does not see fleet-wide controls (the audit log, config.json).
   */
  function can(
    capability: GrantableCapability,
    serverId?: string,
  ): boolean {
    return held(serverId).has(capability);
  }

  /** Does the user hold `capability` on at least one server? */
  function canAnywhere(capability: GrantableCapability): boolean {
    if (held(undefined).has(capability)) return true;
    return Object.values(capabilities.value).some((caps) =>
      caps.includes(capability),
    );
  }

  /**
   * Server ids the user may act on with `capability`, for pickers and tab
   * visibility. Servers the caller cannot see are never in /api/status, so
   * this narrows a list they already have rather than disclosing one.
   */
  function serversWith(
    capability: GrantableCapability,
    serverIds: readonly string[],
  ): string[] {
    return serverIds.filter((id) => held(id).has(capability));
  }

  /** True when the user holds nothing at all: render the empty state. */
  const hasNoAccess = computed(
    () => Object.keys(capabilities.value).length === 0,
  );

  return { can, canAnywhere, serversWith, hasNoAccess, capabilities };
}
