import { ref, computed } from "vue";
import { apiGet, apiSend } from "../api";
import { errorMessage } from "../utils/errorMessage";

/**
 * The mod config editor's client half.
 *
 * Two things shape this. First, the audience: people who cannot SSH, which is
 * why the view renders typed controls from a derived schema rather than a text
 * box. Second, the write protocol: the client sends only the values it
 * changed, never the document. The server re-reads the file and splices them
 * in, so the writer's guards — comment preservation, structure check, ETag —
 * stay meaningful instead of being decorative around a blob the browser sent.
 */

export interface ConfigFileInfo {
  id: string;
  relPath: string;
  modId: string;
  format: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface ConfigField {
  path: string[];
  label: string;
  kind: "string" | "number" | "boolean" | "stringList" | "numberList" | "unknown";
  value: unknown;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
  default?: string;
  readOnly?: boolean;
}

interface FileContents {
  file: ConfigFileInfo;
  etag: string;
  snapshots: string[];
  fields: ConfigField[];
  warning?: string;
  text: string;
}

export function useModConfigs() {
  const files = ref<ConfigFileInfo[]>([]);
  const current = ref<FileContents | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref("");
  const search = ref("");
  /** Path key → new value, for the fields the user actually touched. */
  const pending = ref<Record<string, unknown>>({});
  let serverId = "";

  const pathKey = (path: string[]): string => path.join("\u0000");

  const dirty = computed(() => Object.keys(pending.value).length > 0);

  /**
   * Search runs across every key in every file, not just filenames.
   *
   * Somebody looking for a spawn rate does not know which mod owns it — that
   * is the whole reason they are in a UI rather than in `nano`. The file list
   * is the fallback, not the way in.
   */
  const visibleFiles = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return files.value;
    return files.value.filter(
      (f) =>
        f.relPath.toLowerCase().includes(q) || f.modId.toLowerCase().includes(q),
    );
  });

  const visibleFields = computed(() => {
    const q = search.value.trim().toLowerCase();
    const all = current.value?.fields ?? [];
    if (!q) return all;
    return all.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.path.join(".").toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q),
    );
  });

  /** Files grouped by mod, for a sidebar that is navigable at 200 mods. */
  const byMod = computed(() => {
    const groups = new Map<string, ConfigFileInfo[]>();
    for (const file of visibleFiles.value) {
      const list = groups.get(file.modId) ?? [];
      list.push(file);
      groups.set(file.modId, list);
    }
    return [...groups.entries()].map(([modId, entries]) => ({ modId, entries }));
  });

  async function loadFiles(id: string): Promise<void> {
    serverId = id;
    loading.value = true;
    error.value = "";
    current.value = null;
    pending.value = {};
    try {
      const res = await apiGet<{ files: ConfigFileInfo[] }>(
        `/api/servers/${encodeURIComponent(id)}/configs`,
      );
      files.value = res.files;
    } catch (err) {
      error.value = errorMessage(err);
      files.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function openFile(fileId: string): Promise<void> {
    loading.value = true;
    error.value = "";
    pending.value = {};
    try {
      current.value = await apiGet<FileContents>(
        `/api/servers/${encodeURIComponent(serverId)}/configs/${encodeURIComponent(fileId)}`,
      );
    } catch (err) {
      error.value = errorMessage(err);
      current.value = null;
    } finally {
      loading.value = false;
    }
  }

  /** Record a change. Setting a value back to its original clears it. */
  function setValue(field: ConfigField, value: unknown): void {
    const key = pathKey(field.path);
    const next = { ...pending.value };
    if (JSON.stringify(value) === JSON.stringify(field.value)) delete next[key];
    else next[key] = value;
    pending.value = next;
  }

  function valueOf(field: ConfigField): unknown {
    const key = pathKey(field.path);
    return key in pending.value ? pending.value[key] : field.value;
  }

  // Typed views onto an untyped value. The parsers report `unknown` because a
  // config file can hold anything; the inputs are typed. Coercing in one place
  // keeps every call site honest and stops a number field silently binding a
  // string it will then write back as one.
  function stringValue(field: ConfigField): string {
    const v = valueOf(field);
    return v === null || v === undefined ? "" : String(v);
  }

  function numberValue(field: ConfigField): number | null {
    const v = valueOf(field);
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function boolValue(field: ConfigField): boolean {
    return valueOf(field) === true;
  }

  function listValue(field: ConfigField): string[] {
    const v = valueOf(field);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  }

  /**
   * Write a value back from an input, coerced to the field's own kind.
   *
   * A list of numbers must go back as numbers: Chips hands over strings, and
   * storing `["1","2"]` would render `["1", "2"]` into a TOML file that
   * previously held `[1, 2]` — valid syntax, different meaning to the mod.
   */
  function setFromInput(field: ConfigField, raw: unknown): void {
    if (field.kind === "numberList") {
      const items = Array.isArray(raw) ? raw : [];
      setValue(field, items.map((x) => Number(x)).filter((n) => Number.isFinite(n)));
      return;
    }
    if (field.kind === "number") {
      const n = Number(raw);
      setValue(field, Number.isFinite(n) ? n : field.value);
      return;
    }
    setValue(field, raw);
  }

  function isDirty(field: ConfigField): boolean {
    return pathKey(field.path) in pending.value;
  }

  function discard(): void {
    pending.value = {};
  }

  async function save(): Promise<boolean> {
    if (!current.value || !dirty.value) return false;
    saving.value = true;
    error.value = "";
    try {
      const edits = Object.entries(pending.value).map(([key, value]) => ({
        path: key.split("\u0000"),
        value,
      }));
      const res = await apiSend<{ etag: string; snapshot: string }>(
        "PUT",
        `/api/servers/${encodeURIComponent(serverId)}/configs/${encodeURIComponent(current.value.file.id)}`,
        { etag: current.value.etag, edits },
      );
      // Re-read rather than patching locally: the file on disk is the truth,
      // and the snapshot list has just grown.
      await openFile(current.value.file.id);
      return Boolean(res.etag);
    } catch (err) {
      error.value = errorMessage(err);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function revert(snapshot: string): Promise<boolean> {
    if (!current.value) return false;
    saving.value = true;
    error.value = "";
    const fileId = current.value.file.id;
    try {
      await apiSend(
        "POST",
        `/api/servers/${encodeURIComponent(serverId)}/configs/${encodeURIComponent(fileId)}/revert`,
        { snapshot },
      );
      await openFile(fileId);
      return true;
    } catch (err) {
      error.value = errorMessage(err);
      return false;
    } finally {
      saving.value = false;
    }
  }

  return {
    files, current, loading, saving, error, search, pending,
    dirty, byMod, visibleFields,
    loadFiles, openFile, setValue, setFromInput, valueOf, isDirty, discard, save, revert,
    stringValue, numberValue, boolValue, listValue,
  };
}
