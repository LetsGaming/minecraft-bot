import { computed, ref } from "vue";
import { isRecord } from "../utils/isRecord";
import { useToast } from "primevue/usetoast";
import { ApiError, apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";
import { useEditableDocument, type DocUnits } from "./useEditableDocument";
import { t } from "../i18n";

// Shapes for the /api/commands payload
export interface ManifestEntry {
  name: string;
  description: string;
  /** Source folder under commands/, used to group the dashboard by category. */
  category?: string;
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
  /** Hash of config.json as of this read; the concurrency token for saving. */
  hash: string;
  manifest: { slash: ManifestEntry[]; ingame: ManifestEntry[] };
  /**
   * How often each command was actually used, over `windowDays`.
   * Commands absent from `byCommand` were not used at all: the manifest
   * is the full list, so a missing entry is a real zero.
   */
  usage: {
    windowDays: number;
    byCommand: Record<
      string,
      { count: number; users: number; lastUsedAt: number | null }
    >;
  };
  scopes: { guildIds: string[]; serverIds: string[] };
  commandOptions: Record<string, CommandOptionSpec[]>;
  overrides: {
    global: Record<string, Override>;
    guilds: Record<string, Record<string, Override>>;
    servers: Record<string, Record<string, Override>>;
  };
  effective: Record<string, Record<string, { enabled: boolean; adminOnly: boolean }>>;
}

type OverrideMap = Record<string, Override>;

export interface OverrideDoc {
  global: OverrideMap;
  guilds: Record<string, OverrideMap>;
  servers: Record<string, OverrideMap>;
}

/**
 * One tracked unit per (scope, command): `global.<cmd>`,
 * `guilds.<id>.<cmd>`, `servers.<id>.<cmd>`. That is the grain a person edits
 * and the grain a conflict should be decided at.
 */
const overrideUnits: DocUnits<OverrideDoc> = {
  read(doc) {
    const out: Record<string, unknown> = {};
    for (const [name, o] of Object.entries(doc.global)) out[`global.${name}`] = o;
    for (const kind of ["guilds", "servers"] as const) {
      for (const [id, block] of Object.entries(doc[kind])) {
        for (const [name, o] of Object.entries(block)) out[`${kind}.${id}.${name}`] = o;
      }
    }
    return out;
  },
  write(doc, key, value) {
    const parts = key.split(".");
    let block: OverrideMap;
    let name: string;
    if (parts[0] === "global") {
      block = doc.global;
      name = parts.slice(1).join(".");
    } else {
      const kind = parts[0] as "guilds" | "servers";
      block = doc[kind][parts[1]!] ??= {};
      name = parts.slice(2).join(".");
    }
    if (value === undefined) delete block[name];
    else block[name] = value as Override;
  },
};

const emptyDoc = (): OverrideDoc => ({ global: {}, guilds: {}, servers: {} });

/**
 * All the Commands-view business logic: loading the manifest + override
 * matrix, tracking edits per scope (global / a guild / a server), and saving
 * them back by merging into the full config. The view keeps only presentation
 * (labels, filtering, accordion state). Dirty tracking, the load-time hash and
 * conflict handling come from useEditableDocument.
 */
export function useCommands() {
  const toast = useToast();

  const scope = ref("global");
  /** HTTP status of the last failed load; 0 when the last load worked or never reached the server. */
  const loadStatus = ref(0);

  const editor = useEditableDocument<OverrideDoc, CommandsResponse>(
    {
      async load() {
        let res: CommandsResponse;
        try {
          res = await apiGet<CommandsResponse>("/api/commands");
          loadStatus.value = 0;
        } catch (err) {
          loadStatus.value = err instanceof ApiError ? err.status : 0;
          throw err;
        }
        return {
          doc: {
            global: res.overrides.global,
            guilds: res.overrides.guilds,
            servers: res.overrides.servers,
          },
          token: res.hash,
          meta: res,
        };
      },
      async save({ token, draft }) {
        // The body is built from the current file, but the hash sent is the
        // one from the load: if anything changed since, the write is refused
        // rather than applied on top of someone else's edit.
        const res = await apiGet<ConfigResponse>("/api/config");
        const config = isRecord(res.config) ? res.config : {};
        config.commands = draft.global;
        // config.guilds / config.servers are maps of per-scope config objects
        // in the schema-driven config; assert that nested shape to edit
        // `.commands` in place. Each entry is guard-checked before it's touched.
        const guilds = (config.guilds ?? {}) as Record<string, Record<string, unknown>>;
        for (const [gid, block] of Object.entries(draft.guilds)) {
          if (!guilds[gid]) continue;
          if (Object.keys(block).length > 0) guilds[gid].commands = block;
          else delete guilds[gid].commands;
        }
        const servers = (config.servers ?? {}) as Record<string, Record<string, unknown>>;
        for (const [sid, block] of Object.entries(draft.servers)) {
          if (!servers[sid]) continue;
          if (Object.keys(block).length > 0) servers[sid].commands = block;
          else delete servers[sid].commands;
        }
        return apiSend<{ warnings?: string[] }>("PUT", "/api/config", {
          baseHash: token,
          config,
        });
      },
    },
    { units: overrideUnits },
  );

  const data = computed(() => editor.meta.value ?? null);
  /**
   * The bot has not written its command manifest yet. /api/commands answers
   * 503 for nothing else, so this is a "start the bot" state, not a fault.
   */
  const manifestMissing = computed(() => loadStatus.value === 503 && !editor.ready.value);
  const overrides = computed(() => editor.draft.value ?? emptyDoc());
  /** Persistent save-failure lines: the failure itself, then the backend's validation list. */
  const saveFailure = computed(() => [
    ...(editor.saveError.value ? [editor.saveError.value] : []),
    ...editor.fieldErrors.value.map((e) => e.replace(/^\s*-\s*/, "")),
  ]);

  async function load(): Promise<void> {
    await editor.load();
  }

  /**
   * Throw the edits away and go back to what the server last confirmed.
   *
   * Without this the only exit from a half-finished change was reloading the
   * page, which is a destructive action dressed as a browser control: it
   * looks identical to the one that keeps your work.
   */
  function discard(): void {
    editor.discard();
  }

  /** How many commands carry an override at the current scope. */
  function overriddenCount(): number {
    return Object.keys(currentBlock()).length;
  }

  /** Does this command differ from what it would inherit at this scope? */
  function isOverridden(name: string): boolean {
    return currentBlock()[name] !== undefined;
  }

  /** How many (scope, command) overrides were edited but not yet saved. */
  function pendingCount(): number {
    return editor.dirtyKeys.value.length;
  }

  /**
   * Clear every override at the current scope in one step.
   *
   * Undoing 45 commands one segmented control at a time is not a workflow,
   * and it is the exact thing someone wants after experimenting on a guild.
   */
  function resetScope(): void {
    const block = currentBlock();
    for (const name of Object.keys(block)) delete block[name];
  }

  /** The mutable override block for the currently selected scope. */
  function currentBlock(): OverrideMap {
    const doc = editor.draft.value;
    if (!doc) return {};
    if (scope.value.startsWith("guild:")) {
      return (doc.guilds[scope.value.slice(6)] ??= {});
    }
    if (scope.value.startsWith("server:")) {
      return (doc.servers[scope.value.slice(7)] ??= {});
    }
    return doc.global;
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
  }

  async function save(): Promise<boolean> {
    const ok = await editor.save();
    if (ok) {
      toast.add({
        severity: "success",
        summary: t("commands.savedToast"),
        detail: t("commands.savedToastDetail"),
        life: 3000,
      });
    }
    return ok;
  }

  return {
    loadError: editor.loadError, loading: editor.loading, ready: editor.ready,
    saving: editor.saving, dirty: editor.dirty, saved: editor.saved,
    stale: editor.stale, conflicts: editor.conflicts,
    saveFailure, scope, data, overrides, manifestMissing,
    load, currentBlock, fieldValue, setField, effectiveFor, save,
    optionSpecs, optionValue, setOption,
    discard, resetScope, isOverridden, overriddenCount, pendingCount,
    resolveConflict: editor.resolveConflict,
    reloadDiscardingMine: editor.reloadDiscardingMine,
  };
}
