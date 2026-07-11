import { ref } from "vue";
import { useToast } from "primevue/usetoast";
import { apiGet, apiSend } from "../api";
import type { JsonSchema } from "./useConfig";

/**
 * Per-guild config editor logic — the guild-manager counterpart to useConfig,
 * scoped to ONE guild's config block. Loads the block + the GuildConfig schema
 * (structure only), edits through the schema-driven form, and saves with the
 * same optimistic-concurrency contract. Never exposes servers or other guilds.
 */
export function useGuildConfig() {
  const toast = useToast();

  const schema = ref<JsonSchema | null>(null); // the GuildConfig node
  const definitions = ref<Record<string, unknown> | undefined>(undefined);
  const model = ref<Record<string, unknown> | null>(null);
  const baseHash = ref("");
  const errors = ref<string[]>([]);
  const warnings = ref<string[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  // Kept internal so it can't collide with a `guildId` prop on the component.
  let currentGuildId = "";

  async function load(id: string): Promise<void> {
    currentGuildId = id;
    errors.value = [];
    warnings.value = [];
    loading.value = true;
    try {
      const cfg = await apiGet<{
        hash: string;
        guildConfig: Record<string, unknown>;
      }>(`/api/guilds/${id}/config`);
      model.value = cfg.guildConfig ?? {};
      baseHash.value = cfg.hash;
      // Schema is the same for every guild — fetch it once.
      if (schema.value === null) {
        const s = await apiGet<{
          schema: JsonSchema;
          definitions: Record<string, unknown>;
        }>("/api/guilds/config-schema");
        schema.value = s.schema;
        definitions.value = s.definitions;
      }
    } catch (err) {
      errors.value = [`Could not load guild config: ${(err as Error).message}`];
    } finally {
      loading.value = false;
    }
  }

  function setField(key: string, value: unknown): void {
    if (!model.value) return;
    if (value === undefined) delete model.value[key];
    else model.value[key] = value;
  }

  async function save(): Promise<boolean> {
    errors.value = [];
    warnings.value = [];
    saving.value = true;
    try {
      const res = await apiSend<{ ok: boolean; changed?: boolean; warnings: string[] }>(
        "PUT",
        `/api/guilds/${currentGuildId}/config`,
        { baseHash: baseHash.value, guildConfig: model.value },
      );
      warnings.value = res.warnings ?? [];
      const noChange = res.changed === false;
      toast.add({
        severity: noChange ? "info" : "success",
        summary: noChange ? "No changes" : "Guild config saved",
        detail: noChange ? "Nothing to save." : "The bot applies it automatically.",
        life: 3000,
      });
      await load(currentGuildId); // refresh hash for a follow-up save
      return true;
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("changed since you loaded it")) {
        errors.value = [message];
        await load(currentGuildId).catch(() => {});
      } else {
        errors.value = message.startsWith("[")
          ? (JSON.parse(message) as string[])
          : [message];
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  return {
    schema,
    definitions,
    model,
    baseHash,
    errors,
    warnings,
    loading,
    saving,
    load,
    setField,
    save,
  };
}
