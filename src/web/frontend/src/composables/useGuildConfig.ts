import { computed, ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { groupErrors } from "../utils/fieldErrors";
import { useNotify } from "./useNotify";
import { apiGet, apiSend } from "../api";
import type { JsonSchema } from "./useConfig";
import { useEditableDocument } from "./useEditableDocument";
import { t } from "../i18n";

type GuildDoc = Record<string, unknown>;

/**
 * Per-guild config editor logic: the guild-manager counterpart to useConfig,
 * scoped to ONE guild's config block. The concurrency token is a hash of that
 * block alone, so a save elsewhere in config.json does not conflict. Dirty
 * tracking, conflict handling and the save states come from
 * useEditableDocument. Never exposes servers or other guilds.
 */
export function useGuildConfig() {
  const notify = useNotify();

  const schema = ref<JsonSchema | null>(null); // the GuildConfig node
  const definitions = ref<Record<string, unknown> | undefined>(undefined);
  const schemaError = ref("");

  // Kept internal so it can't collide with a `guildId` prop on the component.
  let currentGuildId = "";

  const editor = useEditableDocument<GuildDoc>({
    async load() {
      const cfg = await apiGet<{ hash: string; guildConfig: GuildDoc }>(
        `/api/guilds/${encodeURIComponent(currentGuildId)}/config`,
      );
      return { doc: cfg.guildConfig ?? {}, token: cfg.hash };
    },
    async save({ token, draft }) {
      return apiSend<{ warnings?: string[]; changed?: boolean }>(
        "PUT",
        `/api/guilds/${encodeURIComponent(currentGuildId)}/config`,
        { baseHash: token, guildConfig: draft },
      );
    },
  });

  async function loadSchema(): Promise<void> {
    schema.value = null;
    definitions.value = undefined;
    schemaError.value = "";
    try {
      const s = await apiGet<{
        schema: JsonSchema;
        definitions: Record<string, unknown>;
      }>("/api/guilds/config-schema");
      schema.value = s.schema;
      definitions.value = s.definitions;
    } catch (err) {
      schemaError.value = errorMessage(err);
    }
  }

  /** Open a guild: read its block and the current schema (never a cached one). */
  async function load(id: string): Promise<void> {
    currentGuildId = id;
    editor.reset();
    await Promise.all([editor.load(), loadSchema()]);
  }

  async function retry(): Promise<void> {
    await load(currentGuildId);
  }

  async function save(): Promise<boolean> {
    const ok = await editor.save();
    if (ok) {
      notify.ok(t("guildEditor.savedToast"), t("guildEditor.savedToastDetail"));
    }
    return ok;
  }

  const grouped = computed(() =>
    groupErrors(editor.fieldErrors.value, (path) => {
      const rest = path[0] === "guilds" && path[1] === currentGuildId ? path.slice(2) : path;
      return rest[0] ?? null;
    }),
  );
  const sectionErrors = computed(() => grouped.value.bySection);
  const errors = computed(() => [
    ...(editor.saveError.value ? [editor.saveError.value] : []),
    ...grouped.value.general,
  ]);

  const canSave = computed(
    () =>
      editor.ready.value &&
      !editor.loading.value &&
      editor.dirty.value &&
      !editor.saving.value &&
      editor.conflicts.value.length === 0,
  );

  return {
    schema, definitions, schemaError,
    model: editor.draft,
    baseline: editor.baseline,
    fieldErrors: editor.fieldErrors,
    saveError: editor.saveError,
    errors, sectionErrors, canSave,
    warnings: editor.warnings,
    loading: editor.loading, loadError: editor.loadError, ready: editor.ready,
    saving: editor.saving, stale: editor.stale,
    dirty: editor.dirty, isDirty: editor.isDirty,
    pendingCount: computed(() => editor.dirtyKeys.value.length),
    conflicts: editor.conflicts, resolveConflict: editor.resolveConflict,
    reloadDiscardingMine: editor.reloadDiscardingMine,
    discard: editor.discard,
    load, retry, setField: editor.setField, save,
  };
}
