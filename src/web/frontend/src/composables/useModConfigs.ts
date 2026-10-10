import { ref, computed } from "vue";
import { apiGet, apiSend } from "../api";
import { errorMessage } from "../utils/errorMessage";
import { disambiguateLabels } from "../utils/fieldLabels";
import type { StaleInfo, QueuedWriteResult } from "@mcbot/schema/contract.js";
import type { ConfigFileInfo } from "@mcbot/schema";
import {
  groupFiles,
  limitSections,
  pathKey,
  sectionsOf,
} from "../utils/configTree";

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

/** A queued edit whose key moved on disk while it waited. */
export interface EditConflict {
  keyPath: string[];
  queued: unknown;
  base: unknown;
  current: unknown;
  queuedAt: number;
  byTag: string | null;
  /** Which file it belongs to. Present on preview results. */
  fileId?: string;
}

export type { ConfigFileInfo };

export interface ConfigField {
  path: string[];
  label: string;
  /**
   * The label as rendered: qualified by its parent key when the bare label
   * repeats inside the same file. Derived on load, never per keystroke, so
   * a field cannot rename itself while someone is searching.
   */
  displayLabel?: string;
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
  /** Present when this was served from cache rather than read live. */
  stale?: StaleInfo | null;
  file: ConfigFileInfo;
  etag: string;
  snapshots: string[];
  fields: ConfigField[];
  warning?: string;
  /** False for a file type with no editor; only its source is shown. */
  supported: boolean;
  /** The whole file is view-only: unsupported, parse warning, or too large. */
  readOnly: boolean;
  /** Present only when requested, or when there is nothing else to show. */
  text?: string;
}

/** Fields drawn at once; more are revealed on request so a huge file stays responsive. */
const FIELD_PAGE = 200;
/** Above this many files or fields, groups and sections start collapsed. */
const COLLAPSE_ABOVE = 40;

export function useModConfigs() {
  const files = ref<ConfigFileInfo[]>([]);
  /** The wrapper stopped listing at its file limit. */
  const truncated = ref(false);
  /** Explicit open/closed choices for mod groups, folders and sections. */
  const openState = ref<Record<string, boolean>>({});
  const fieldLimit = ref(FIELD_PAGE);
  const current = ref<FileContents | null>(null);
  /**
   * Set when the backend served a cached read because the wrapper did not
   * answer. Kept as two separate signals because they degrade independently:
   * the file list can be live while a specific file is stale, and vice versa.
   */
  const indexStale = ref<StaleInfo | null>(null);
  const fileStale = ref<StaleInfo | null>(null);
  /**
   * Set when a save was held because the wrapper was unreachable. The change
   * is safe but nothing has been written, which is a materially different
   * outcome from a save and is never reported as one.
   */
  const queued = ref<QueuedWriteResult | null>(null);
  /** How many edits are waiting across every file on this server. */
  const pendingCount = ref(0);
  /** Queued edits whose key changed on disk while they waited. */
  const conflicts = ref<EditConflict[]>([]);

  async function refreshPending(): Promise<void> {
    try {
      const res = await apiGet<{ pending: unknown[] }>(
        `/api/servers/${encodeURIComponent(serverId)}/configs-queue`,
      );
      pendingCount.value = res.pending.length;
    } catch {
      // Not knowing how many are queued must not break the editor.
      pendingCount.value = 0;
    }
    // The preview needs the wrapper, so it is allowed to fail on its own
    // without taking the count with it: knowing three edits are waiting is
    // useful even when we cannot yet say whether any of them conflict.
    try {
      const preview = await apiGet<{ conflicts: EditConflict[] }>(
        `/api/servers/${encodeURIComponent(serverId)}/configs-queue/preview`,
      );
      conflicts.value = preview.conflicts;
    } catch {
      conflicts.value = [];
    }
  }

  /**
   * Resolve one conflict.
   *
   * "Keep mine" rebases onto the value the operator was shown, so the edit
   * flows through the ordinary flush rather than a second write path that
   * only conflict resolution would use.
   */
  async function resolveConflict(
    conflict: EditConflict,
    choice: "queued" | "current",
  ): Promise<void> {
    const fileId = conflict.fileId ?? current.value?.file.id;
    if (!fileId) return;
    await apiSend("POST", `/api/servers/${encodeURIComponent(serverId)}/configs-queue/resolve`, {
      fileId,
      keyPath: conflict.keyPath,
      choice,
      currentValue: conflict.current,
    });
    await refreshPending();
  }

  /** Push everything held for this server now that the wrapper answers. */
  async function flushQueue(): Promise<{ applied: number; conflicts: unknown[] }> {
    const res = await apiSend<{ applied: number; conflicts: unknown[] }>(
      "POST",
      `/api/servers/${encodeURIComponent(serverId)}/configs-queue/flush`,
    );
    await refreshPending();
    return res;
  }
  const loading = ref(false);
  const saving = ref(false);
  const error = ref("");
  const search = ref("");
  /** Path key → new value, for the fields the user actually touched. */
  const pending = ref<Record<string, unknown>>({});
  let serverId = "";

  const dirty = computed(() => Object.keys(pending.value).length > 0);

  const filtering = computed(() => search.value.trim() !== "");

  /** Files matching the filter by path or mod. Field names are filtered inside the open file. */
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
        (f.displayLabel ?? f.label).toLowerCase().includes(q) ||
        f.path.join(".").toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q),
    );
  });

  /** Files grouped by mod, then by folder, for a list that stays navigable at 200 mods. */
  const byMod = computed(() => groupFiles(visibleFiles.value));

  const sections = computed(() => sectionsOf(visibleFields.value));
  const shown = computed(() => limitSections(sections.value, fieldLimit.value));
  const hiddenFieldCount = computed(() => shown.value.hidden);
  const shownSections = computed(() => shown.value.sections);

  /** Whether a group or section is expanded: an explicit choice wins, then the size-based default. */
  function isOpen(key: string, defaultOpen: boolean): boolean {
    if (filtering.value) return true;
    const chosen = openState.value[key];
    if (chosen !== undefined) return chosen;
    return defaultOpen;
  }

  function toggleOpen(key: string, defaultOpen: boolean): void {
    openState.value = { ...openState.value, [key]: !isOpen(key, defaultOpen) };
  }

  const collapseGroups = computed(() => files.value.length > COLLAPSE_ABOVE);
  const collapseSections = computed(() => (current.value?.fields.length ?? 0) > COLLAPSE_ABOVE);

  function showMoreFields(): void {
    fieldLimit.value += FIELD_PAGE;
  }

  async function loadFiles(id: string): Promise<void> {
    serverId = id;
    loading.value = true;
    error.value = "";
    current.value = null;
    pending.value = {};
    openState.value = {};
    try {
      const res = await apiGet<{
        files: ConfigFileInfo[];
        truncated?: boolean;
        stale?: StaleInfo | null;
      }>(`/api/servers/${encodeURIComponent(id)}/configs`);
      files.value = res.files;
      truncated.value = res.truncated ?? false;
      indexStale.value = res.stale ?? null;
    } catch (err) {
      error.value = errorMessage(err);
      files.value = [];
      truncated.value = false;
      indexStale.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function openFile(fileId: string, withText = false): Promise<void> {
    loading.value = true;
    error.value = "";
    pending.value = {};
    fieldLimit.value = FIELD_PAGE;
    try {
      const contents = await apiGet<FileContents>(
        `/api/servers/${encodeURIComponent(serverId)}/configs/${encodeURIComponent(fileId)}${withText ? "?text=1" : ""}`,
      );
      current.value = {
        ...contents,
        fields: disambiguateLabels(contents.fields),
      };
      fileStale.value = contents.stale ?? null;
    } catch (err) {
      error.value = errorMessage(err);
      current.value = null;
      fileStale.value = null;
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

  /** Whether the whole open file is view-only, whatever the user may do. */
  const fileReadOnly = computed(() => current.value?.readOnly ?? false);

  /** Fetch the raw file text for the source view. */
  async function loadSource(): Promise<void> {
    if (!current.value || current.value.text !== undefined) return;
    const fileId = current.value.file.id;
    const keep = { ...pending.value };
    await openFile(fileId, true);
    pending.value = keep;
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
        path: JSON.parse(key) as string[],
        value,
      }));
      const res = await apiSend<
        { etag: string; snapshot: string } | QueuedWriteResult
      >(
        "PUT",
        `/api/servers/${encodeURIComponent(serverId)}/configs/${encodeURIComponent(current.value.file.id)}`,
        { etag: current.value.etag, edits },
      );
      if ("queued" in res) {
        // Held, not written. The pending edits deliberately stay in the form:
        // the queue is the durable copy, but a form that emptied itself would
        // tell the operator their change had landed.
        queued.value = res;
        await refreshPending();
        return true;
      }
      queued.value = null;
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
    indexStale, fileStale, queued, pendingCount, conflicts,
    refreshPending, flushQueue, resolveConflict,
    files, current, loading, saving, error, search, pending,
    dirty, byMod, visibleFields, truncated, filtering, fileReadOnly,
    shownSections, hiddenFieldCount, showMoreFields, isOpen, toggleOpen,
    collapseGroups, collapseSections, loadSource,
    loadFiles, openFile, setValue, setFromInput, valueOf, isDirty, discard, save, revert,
    stringValue, numberValue, boolValue, listValue,
  };
}
