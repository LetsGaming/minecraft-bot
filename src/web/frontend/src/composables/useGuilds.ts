import { computed, ref } from "vue";
import { apiGet } from "../api";
import { useLoader } from "./useLoader";
import { t } from "../i18n";
import type { SetupGuild } from "../api";

// Shared guild-name resolution. The config only stores guild IDs, but the
// UI should always show human names. This fetches the bot's guild list
// from Discord once and exposes a lookup, so multiple views don't each
// re-implement the fetch. Module-level state makes it a lightweight
// singleton cache for the session; call load() to (re)populate.

const loader = useLoader(async () => (await apiGet<{ guilds: SetupGuild[] }>("/api/setup/guilds")).guilds, {
  keepDataOnError: true,
});
const guilds = computed<SetupGuild[]>(() => loader.data.value ?? []);
/** True once a read has succeeded; a failed first read leaves it false so the next `load()` retries. */
const loaded = ref(false);
const loading = loader.loading;
const error = loader.error;
const cause = loader.cause;
let inFlight: Promise<void> | null = null;

/** Concurrent callers share one request, so awaiting `load()` always means the data is there. */
function load(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (loaded.value && !force) return Promise.resolve();
  inFlight = loader
    .load()
    .then((ok) => {
      if (ok) loaded.value = true;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Human name for a guild ID. Falls back to a short, friendly label when
 * the name isn't known yet (list still loading, Discord unreachable, or
 * the bot was removed from that guild) never a raw snowflake.
 */
function guildName(id: string): string {
  const hit = guilds.value.find((g) => g.id === id);
  if (hit) return hit.name;
  return t("guilds.unknownName", { suffix: id.slice(-4) });
}

/**
 * The guild's real name, or undefined when it genuinely isn't known.
 *
 * `guildName` always returns something printable, which is right for a
 * heading and wrong for substitution: replacing an ID inside a log line with
 * "Guild …3999" would destroy the one identifier that line carried without
 * putting a real name in its place.
 */
function knownGuildName(id: string): string | undefined {
  return guilds.value.find((g) => g.id === id)?.name;
}

function guildIcon(id: string): string | null {
  return guilds.value.find((g) => g.id === id)?.icon ?? null;
}

export function useGuilds() {
  return { guilds, loaded, loading, error, cause, load, guildName, knownGuildName, guildIcon };
}
