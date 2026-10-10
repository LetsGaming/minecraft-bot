import { computed, ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { isRecord } from "../utils/isRecord";
import { groupErrors } from "../utils/fieldErrors";
import { useToast } from "primevue/usetoast";
import { apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";
import { useEditableDocument } from "./useEditableDocument";

export interface JsonSchema {
  $ref?: string;
  properties?: Record<string, unknown>;
  definitions?: Record<string, unknown>;
}

type ConfigDoc = Record<string, unknown>;

/**
 * The full-config editor's logic: load config + JSON schema, edit through the
 * schema-driven form or a raw-JSON textarea, and save changes with the hash
 * that came with the load. Dirty tracking, conflict handling and the
 * loading/saving states come from useEditableDocument; this adds the schema,
 * the raw-JSON view and the mapping of validation errors onto form sections.
 */
export function useConfig() {
  const toast = useToast();

  const placeholder = "•••••";
  const schema = ref<JsonSchema | null>(null);
  const schemaFailed = ref(false);
  const rawMode = ref(false);
  const rawText = ref("");
  const rawError = ref("");

  const editor = useEditableDocument<ConfigDoc>({
    async load() {
      const res = await apiGet<ConfigResponse>("/api/config");
      return { doc: isRecord(res.config) ? res.config : {}, token: res.hash };
    },
    async save({ token, draft }) {
      return apiSend<{ warnings?: string[] }>("PUT", "/api/config", {
        baseHash: token,
        config: draft,
      });
    },
  });

  const model = editor.draft;

  function syncRawFromDraft(): void {
    rawText.value = JSON.stringify(editor.draft.value ?? {}, null, 2);
    rawError.value = "";
  }

  async function load(): Promise<void> {
    const ok = await editor.load();
    if (!ok) return;
    syncRawFromDraft();
    try {
      schema.value = await apiGet<JsonSchema>("/api/config/schema");
      schemaFailed.value = false;
    } catch {
      schema.value = null;
      schemaFailed.value = true;
      rawMode.value = true;
    }
  }

  /** Apply the raw text to the draft when it parses; report why when it does not. */
  function setRawText(text: string): void {
    rawText.value = text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new Error("The config must be a JSON object.");
      editor.draft.value = parsed;
      rawError.value = "";
    } catch (err) {
      rawError.value = errorMessage(err);
    }
  }

  /** Switch views. Leaving raw mode with unparsable text is refused, not guessed at. */
  function setRawMode(on: boolean): void {
    if (on) {
      syncRawFromDraft();
      rawMode.value = true;
      return;
    }
    if (rawError.value) return;
    rawMode.value = false;
  }

  function setTop(key: string, value: unknown): void {
    editor.setField(key, value);
  }

  function discard(): void {
    editor.discard();
    syncRawFromDraft();
  }

  async function save(): Promise<boolean> {
    if (rawMode.value && rawError.value) return false;
    const ok = await editor.save();
    syncRawFromDraft();
    if (ok) {
      toast.add({
        severity: "success",
        summary: "Config saved",
        detail: "Written to config.json. The status chip shows when the bot has applied it.",
        life: 3000,
      });
    }
    return ok;
  }

  async function reloadDiscardingMine(): Promise<void> {
    await editor.reloadDiscardingMine();
    syncRawFromDraft();
  }

  const grouped = computed(() =>
    groupErrors(editor.fieldErrors.value, (path) => path[0] ?? null),
  );
  /** Section key to the validation messages that belong to it. */
  const sectionErrors = computed(() => grouped.value.bySection);
  /** Banner lines: a raw-JSON problem, the save failure, and validation lines with no section. */
  const errors = computed(() => [
    ...(rawError.value ? [`Raw JSON does not parse: ${rawError.value}`] : []),
    ...(editor.saveError.value ? [editor.saveError.value] : []),
    ...grouped.value.general,
  ]);

  const pendingCount = computed(() => editor.dirtyKeys.value.length);
  const canSave = computed(
    () =>
      editor.ready.value &&
      editor.dirty.value &&
      !editor.saving.value &&
      editor.conflicts.value.length === 0 &&
      !(rawMode.value && rawError.value),
  );

  return {
    placeholder, schema, schemaFailed, model, rawMode, rawText, rawError,
    errors, sectionErrors, pendingCount, canSave,
    loading: editor.loading, loadError: editor.loadError, ready: editor.ready,
    saving: editor.saving, saved: editor.saved, warnings: editor.warnings,
    stale: editor.stale, dirty: editor.dirty, isDirty: editor.isDirty,
    conflicts: editor.conflicts, resolveConflict: editor.resolveConflict,
    load, setTop, setRawMode, setRawText, discard, save, reloadDiscardingMine,
  };
}
