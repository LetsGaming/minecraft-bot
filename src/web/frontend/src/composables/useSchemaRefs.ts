import { reactive, type InjectionKey } from "vue";
import { apiGet, type SetupChannel, type SetupRole } from "../api";

export interface RefOption {
  id: string;
  label: string;
}

/**
 * Named options for the ID-reference dropdowns, threaded from a config editor
 * down to every SchemaField via provide/inject so the recursive renderer can
 * show entity names instead of raw IDs. Empty lists (e.g. a guild-manager who
 * can't list servers, or an editor with no guild context) make SchemaField
 * fall back to a text/chips input.
 */
export interface SchemaRefs {
  servers: RefOption[];
  channels: RefOption[];
  roles: RefOption[];
}

export const SchemaRefsKey: InjectionKey<SchemaRefs> = Symbol("schemaRefs");

// Discord channel types that can receive messages (text, announcement, forum).
const POSTABLE_CHANNEL_TYPES = new Set([0, 5, 15]);

export function useSchemaRefs() {
  const refs = reactive<SchemaRefs>({ servers: [], channels: [], roles: [] });

  /** Configured Minecraft servers (sysadmin-only; managers get a 403 → none). */
  async function loadServers(): Promise<void> {
    try {
      const res = await apiGet<{ servers: string[] }>("/api/setup/servers");
      // Server keys are already human-readable (e.g. "smp"), so id == label.
      refs.servers = res.servers.map((id) => ({ id, label: id }));
    } catch {
      refs.servers = [];
    }
  }

  /** A guild's text channels + roles (only if the caller manages that guild). */
  async function loadGuild(guildId: string): Promise<void> {
    try {
      const [ch, rl] = await Promise.all([
        apiGet<{ channels: SetupChannel[] }>(
          `/api/setup/guilds/${encodeURIComponent(guildId)}/channels`,
        ),
        apiGet<{ roles: SetupRole[] }>(
          `/api/setup/guilds/${encodeURIComponent(guildId)}/roles`,
        ),
      ]);
      refs.channels = ch.channels
        .filter((c) => POSTABLE_CHANNEL_TYPES.has(c.type))
        .map((c) => ({ id: c.id, label: `#${c.name}` }));
      refs.roles = rl.roles
        .filter((r) => r.name !== "@everyone")
        .map((r) => ({ id: r.id, label: `@${r.name}` }));
    } catch {
      refs.channels = [];
      refs.roles = [];
    }
  }

  return { refs, loadServers, loadGuild };
}
