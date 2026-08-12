import { reactive, type InjectionKey } from "vue";
import { apiGet, type SetupChannel, type SetupRole } from "../api";

export interface RefOption {
  id: string;
  label: string;
}

/**
 * Why a scoped ref set has no channels or roles to offer.
 *
 * The old implementation collapsed three very different situations into one
 * empty array: the fetch is still in flight, the fetch failed, and there is no
 * guild context at all. A field then fell back to a raw-ID text box in all
 * three cases with nothing to say about which it was. Naming the state is what
 * lets a picker say "loading" instead of silently looking broken, and lets a
 * text fallback explain itself instead of looking like the intended design.
 */
export type RefScopeStatus = "ready" | "loading" | "unavailable" | "unscoped";

/**
 * Named options for the ID-reference dropdowns, threaded from a config editor
 * down to every SchemaField via provide/inject so the recursive renderer can
 * show entity names instead of raw IDs.
 */
export interface SchemaRefs {
  servers: RefOption[];
  channels: RefOption[];
  roles: RefOption[];
  /** Why `channels`/`roles` are empty, when they are. */
  status: RefScopeStatus;
}

export const SchemaRefsKey: InjectionKey<SchemaRefs> = Symbol("schemaRefs");

/**
 * Optional resolver for map entry keys: `(mapName, key) => display name`.
 *
 * The config form renders `Record<string, X>` maps by their raw keys, which is
 * right for `servers` (the key *is* the name) and wrong for `guilds`, where
 * the key is a snowflake and the name is a fetch away. Provided by an editor
 * that has the names; absent everywhere else, so MapField keeps its old
 * behaviour rather than depending on a lookup that may not exist.
 */
export type MapKeyLabel = (mapName: string, key: string) => string | undefined;
export const MapKeyLabelKey: InjectionKey<MapKeyLabel> = Symbol("mapKeyLabel");

/**
 * Optional resolver for per-entry ref scopes: `(mapName, key) => refs`.
 *
 * `provide()` runs once per component instance, so a page rendering several
 * guilds at once cannot hand each subtree its own channel list from the map
 * component itself. MapEntry exists as that per-entry component boundary, and
 * asks this resolver what the entry's world looks like. Returning undefined
 * means "no special scope", so the entry inherits whatever its parent
 * provided, which is the right answer for `servers` and every other map.
 *
 * A resolver is expected to be idempotent and may start a fetch on first call:
 * an entry asking for its scope is exactly the signal that it is being
 * rendered and its data is now wanted.
 */
export type SchemaScopeResolver = (
  mapName: string,
  key: string,
) => SchemaRefs | undefined;
export const SchemaScopeKey: InjectionKey<SchemaScopeResolver> =
  Symbol("schemaScope");

// Discord channel types that can receive messages (text, announcement, forum).
const POSTABLE_CHANNEL_TYPES = new Set([0, 5, 15]);

/** Frozen so a consumer cannot mutate the shared empty into something else. */
const NO_OPTIONS = Object.freeze([]) as unknown as RefOption[];

interface GuildEntry {
  channels: RefOption[];
  roles: RefOption[];
  status: RefScopeStatus;
}

/**
 * Module-level, like useGuilds: a session cache keyed by guild.
 *
 * This used to be one flat `{ servers, channels, roles }` per composable
 * instance, and `loadGuild` overwrote `channels`/`roles` wholesale. Fine for a
 * modal editing one guild, impossible for a page rendering three, where
 * loading the second guild's channels erased the first's. Caching per guild
 * also means reopening the same guild's editor does not refetch.
 */
const state = reactive({
  servers: [] as RefOption[],
  byGuild: {} as Record<string, GuildEntry>,
});

/** One stable scope object per guild, so provide/inject identity holds. */
const scopeCache = new Map<string, SchemaRefs>();

/**
 * A live view of one guild's world: global servers, that guild's channels and
 * roles. Plain getters over reactive state, so reading a property during
 * render tracks it and a later fetch re-renders the fields that used it.
 */
function guildScope(guildId: string): SchemaRefs {
  const cached = scopeCache.get(guildId);
  if (cached) return cached;
  const scope: SchemaRefs = {
    get servers() {
      return state.servers;
    },
    get channels() {
      return state.byGuild[guildId]?.channels ?? NO_OPTIONS;
    },
    get roles() {
      return state.byGuild[guildId]?.roles ?? NO_OPTIONS;
    },
    get status() {
      return state.byGuild[guildId]?.status ?? "loading";
    },
  };
  scopeCache.set(guildId, scope);
  return scope;
}

/** The global scope: servers only, and honest about having no guild. */
const globalScope: SchemaRefs = {
  get servers() {
    return state.servers;
  },
  get channels() {
    return NO_OPTIONS;
  },
  get roles() {
    return NO_OPTIONS;
  },
  get status(): RefScopeStatus {
    return "unscoped";
  },
};

export function useSchemaRefs() {
  /** Configured Minecraft servers (sysadmin-only; managers get a 403 → none). */
  async function loadServers(): Promise<void> {
    try {
      const res = await apiGet<{ servers: string[] }>("/api/setup/servers");
      // Server keys are already human-readable (e.g. "smp"), so id == label.
      state.servers = res.servers.map((id) => ({ id, label: id }));
    } catch {
      state.servers = [];
    }
  }

  /**
   * A guild's postable channels and roles, cached.
   *
   * A previous failure is retried on the next call: the usual cause is a
   * permission or connectivity blip, and refusing to retry would strand those
   * fields on a raw-ID box for the rest of the session.
   */
  async function loadGuildRefs(guildId: string): Promise<void> {
    const entry = state.byGuild[guildId];
    if (entry && entry.status !== "unavailable") return;
    state.byGuild[guildId] = { channels: [], roles: [], status: "loading" };
    try {
      const [ch, rl] = await Promise.all([
        apiGet<{ channels: SetupChannel[] }>(
          `/api/setup/guilds/${encodeURIComponent(guildId)}/channels`,
        ),
        apiGet<{ roles: SetupRole[] }>(
          `/api/setup/guilds/${encodeURIComponent(guildId)}/roles`,
        ),
      ]);
      state.byGuild[guildId] = {
        channels: ch.channels
          .filter((c) => POSTABLE_CHANNEL_TYPES.has(c.type))
          .map((c) => ({ id: c.id, label: `#${c.name}` })),
        roles: rl.roles
          .filter((r) => r.name !== "@everyone")
          .map((r) => ({ id: r.id, label: `@${r.name}` })),
        status: "ready",
      };
    } catch {
      // The bot may have been removed from the guild, or lost permission to
      // list its channels. Either way the fields stay editable by ID.
      state.byGuild[guildId] = { channels: [], roles: [], status: "unavailable" };
    }
  }

  /**
   * A scope that follows a changing guild id.
   *
   * `provide()` runs once per instance, so a long-lived editor whose
   * `guildId` prop changes (one dialog reused for every guild) would
   * otherwise be pinned to whichever guild it was first opened with, and
   * quietly offer that guild's channels while editing another. Reading the id
   * inside the getters defers the question to access time, which is render
   * time, so the dialog always describes the guild it is currently showing.
   */
  function dynamicGuildScope(currentId: () => string): SchemaRefs {
    return {
      get servers() {
        return state.servers;
      },
      get channels() {
        return guildScope(currentId()).channels;
      },
      get roles() {
        return guildScope(currentId()).roles;
      },
      get status() {
        return guildScope(currentId()).status;
      },
    };
  }

  /** Fetch on demand and hand back the live scope. Safe to call every render. */
  function scopeForGuild(guildId: string): SchemaRefs {
    void loadGuildRefs(guildId);
    return guildScope(guildId);
  }

  return {
    globalScope, guildScope, dynamicGuildScope, scopeForGuild,
    loadServers, loadGuildRefs,
  };
}
