import { ref } from "vue";
import { errorMessage, parseErrorList } from "../utils/errorMessage";
import { isRecord } from "../utils/isRecord";
import { useToast } from "primevue/usetoast";
import { apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";

// ── Shapes for the /api/commands payload ──
export interface ManifestEntry {
  name: string;
  description: string;
}
export interface Override {
  enabled?: boolean;
  adminOnly?: boolean;
  options?: Record<string, string | number | boolean>;
  [key: string]: unknown;
}
export interface CommandOptionSpec {
  key: string;
  type: "string" | "number" | "boolean";
  label: string;
  placeholder?: string;
  help?: string;
}
export interface CommandsResponse {
  manifest: { slash: ManifestEntry[]; ingame: ManifestEntry[] };
  scopes: { guildIds: string[]; serverIds: string[] };
  commandOptions: Record<string, CommandOptionSpec[]>;
  overrides: {
    global: Record<string, Override>;
    guilds: Record<string, Record<string, Override>>;
    servers: Record<string, Record<string, Override>>;
  };
  effective: Record<string, Record<string, { enabled: boolean; adminOnly: boolean }>>;
}

/**
 * All the Commands-view business logic: loading the manifest + override
 * matrix, tracking edits per scope (global / a guild / a server), and
 * saving them back by merging into the full config. The view keeps only
 * presentation (labels, filtering, accordion state). Toast feedback lives
 * here so the whole save round-trip is self-contained.
 */
export function useCommands() {
  const toast = useToast();

  const loadError = ref("");
  const saving = ref(false);
  const dirty = ref(false);
  const scope = ref("global");
  const data = ref<CommandsResponse | null>(null);
  const overrides = ref({
    global: {} as Record<string, Override>,
    guilds: {} as Record<string, Record<string, Override>>,
    servers: {} as Record<string, Record<string, Override>>,
  });

  async function load(): Promise<void> {
    try {
      const res = await apiGet<CommandsResponse>("/api/commands");
      data.value = res;
      overrides.value = JSON.parse(JSON.stringify(res.overrides));
    } catch (err) {
      loadError.value = errorMessage(err);
    }
  }

  /** The mutable override block for the currently selected scope. */
  function currentBlock(): Record<string, Override> {
    if (scope.value.startsWith("guild:")) {
      const gid = scope.value.slice(6);
      return (overrides.value.guilds[gid] ??= {});
    }
    if (scope.value.startsWith("server:")) {
      const sid = scope.value.slice(7);
      return (overrides.value.servers[sid] ??= {});
    }
    return overrides.value.global;
  }

  function fieldValue(name: string, field: "enabled" | "adminOnly"): string {
    const value = currentBlock()[name]?.[field];
    return value === undefined ? "inherit" : String(value);
  }

  function setField(name: string, field: "enabled" | "adminOnly", raw: string): void {
    const block = currentBlock();
    const entry = (block[name] ??= {});
    if (raw === "inherit") delete entry[field];
    else entry[field] = raw === "true";
    if (Object.keys(entry).length === 0) delete block[name];
    dirty.value = true;
  }

  /** The resolved policy for a command at the current scope, or null. */
  function effectiveFor(name: string): { enabled: boolean; adminOnly: boolean } | null {
    return data.value?.effective[name]?.[scope.value] ?? null;
  }

  /** Which options a command exposes (map → [url], etc.). */
  function optionSpecs(name: string): CommandOptionSpec[] {
    return data.value?.commandOptions?.[name] ?? [];
  }

  /** Current value of a command option at this scope, as a string for inputs. */
  function optionValue(name: string, key: string): string {
    const v = currentBlock()[name]?.options?.[key];
    return v === undefined ? "" : String(v);
  }

  /** Set/clear a command option (empty string clears it → inherits). */
  function setOption(
    name: string,
    key: string,
    raw: string,
    type: "string" | "number" | "boolean",
  ): void {
    const block = currentBlock();
    const entry = (block[name] ??= {});
    const opts = (entry.options ??= {});
    const trimmed = raw.trim();
    if (trimmed === "") {
      delete opts[key];
    } else {
      opts[key] =
        type === "number"
          ? Number(trimmed)
          : type === "boolean"
            ? trimmed === "true"
            : trimmed;
    }
    if (Object.keys(opts).length === 0) delete entry.options;
    if (Object.keys(entry).length === 0) delete block[name];
    dirty.value = true;
  }

  async function save(): Promise<void> {
    saving.value = true;
    try {
      // Read the FULL config envelope (config + baseHash) so the PUT
      // carries optimistic-concurrency info and never writes the
      // envelope's `hash` field into config.json itself.
      const res = await apiGet<ConfigResponse>("/api/config");
      const config = isRecord(res.config) ? res.config : {};
      config.commands = overrides.value.global;
      // config.guilds / config.servers are maps of per-scope config objects in
      // the schema-driven config; assert that nested shape to edit `.commands`
      // in place. Each entry is guard-checked before it's touched.
      const guilds = (config.guilds ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [gid, block] of Object.entries(overrides.value.guilds)) {
        if (!guilds[gid]) continue;
        if (Object.keys(block).length > 0) guilds[gid].commands = block;
        else delete guilds[gid].commands;
      }
      const servers = (config.servers ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [sid, block] of Object.entries(overrides.value.servers)) {
        if (!servers[sid]) continue;
        if (Object.keys(block).length > 0) servers[sid].commands = block;
        else delete servers[sid].commands;
      }

      await apiSend("PUT", "/api/config", { baseHash: res.hash, config });
      dirty.value = false;
      toast.add({
        severity: "success",
        summary: "Saved",
        detail: "Applies on the bot's next config reload (automatic).",
        life: 3000,
      });
      await load();
    } catch (err) {
      const message = errorMessage(err);
      const detail = parseErrorList(message).join("\n");
      toast.add({ severity: "error", summary: "Save failed", detail, life: 5000 });
    } finally {
      saving.value = false;
    }
  }

  return {
    loadError, saving, dirty, scope, data, overrides,
    load, currentBlock, fieldValue, setField, effectiveFor, save,
    optionSpecs, optionValue, setOption,
  };
}
