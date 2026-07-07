import { ref } from "vue";
import { apiGet } from "../api";
import type { SetupGuild } from "../api";

// Shared guild-name resolution. The config only stores guild IDs, but the
// UI should always show human names. This fetches the bot's guild list
// from Discord once and exposes a lookup, so multiple views don't each
// re-implement the fetch. Module-level state makes it a lightweight
// singleton cache for the session; call load() to (re)populate.

const guilds = ref<SetupGuild[]>([]);
const loaded = ref(false);
const loading = ref(false);
const error = ref("");

async function load(force = false): Promise<void> {
  if (loading.value) return;
  if (loaded.value && !force) return;
  loading.value = true;
  error.value = "";
  try {
    const res = await apiGet<{ guilds: SetupGuild[] }>("/api/setup/guilds");
    guilds.value = res.guilds;
    loaded.value = true;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

/**
 * Human name for a guild ID. Falls back to a short, friendly label when
 * the name isn't known yet (list still loading, Discord unreachable, or
 * the bot was removed from that guild) — never a raw snowflake.
 */
function guildName(id: string): string {
  const hit = guilds.value.find((g) => g.id === id);
  if (hit) return hit.name;
  return `Server …${id.slice(-4)}`;
}

function guildIcon(id: string): string | null {
  return guilds.value.find((g) => g.id === id)?.icon ?? null;
}

export function useGuilds() {
  return { guilds, loaded, loading, error, load, guildName, guildIcon };
}
