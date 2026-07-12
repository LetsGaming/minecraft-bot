import { ref, watch } from "vue";
import { errorMessage, parseErrorList } from "../utils/errorMessage";
import { isRecord } from "../utils/isRecord";
import { useToast } from "primevue/usetoast";
import { apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";

export interface JsonSchema {
  $ref?: string;
  properties?: Record<string, unknown>;
  definitions?: Record<string, unknown>;
}

/**
 * The full-config editor's logic: load config + JSON schema, edit either
 * through the schema-driven form or a raw-JSON textarea (kept in sync),
 * and save with optimistic concurrency, server-side validation errors,
 * and warnings surfaced. Toast + error/warning state live here; the view
 * only renders.
 */
export function useConfig() {
  const toast = useToast();

  const placeholder = "•••••";
  const schema = ref<JsonSchema | null>(null);
  const model = ref<Record<string, unknown> | null>(null);
  const rawMode = ref(false);
  const rawText = ref("");
  const baseHash = ref("");
  const errors = ref<string[]>([]);
  const warnings = ref<string[]>([]);
  const saving = ref(false);

  // Keep the raw-JSON view and the form model in sync as raw mode toggles.
  watch(rawMode, (on) => {
    if (on && model.value) {
      rawText.value = JSON.stringify(model.value, null, 2);
    } else if (!on) {
      try {
        model.value = JSON.parse(rawText.value);
      } catch {
        errors.value = ["Raw JSON does not parse — staying in raw mode."];
        rawMode.value = true;
      }
    }
  });

  async function load(): Promise<void> {
    try {
      const res = await apiGet<ConfigResponse>("/api/config");
      model.value = isRecord(res.config) ? res.config : {};
      baseHash.value = res.hash;
      rawText.value = JSON.stringify(model.value, null, 2);
    } catch (err) {
      errors.value = [`Could not load config: ${errorMessage(err)}`];
      return;
    }
    try {
      schema.value = await apiGet<JsonSchema>("/api/config/schema");
    } catch {
      schema.value = null;
      rawMode.value = true;
    }
  }

  async function reload(): Promise<void> {
    const res = await apiGet<ConfigResponse>("/api/config");
    model.value = isRecord(res.config) ? res.config : {};
    baseHash.value = res.hash;
    if (rawMode.value) rawText.value = JSON.stringify(model.value, null, 2);
  }

  function setTop(key: string, value: unknown): void {
    if (!model.value) return;
    if (value === undefined) delete model.value[key];
    else model.value[key] = value;
  }

  async function save(): Promise<void> {
    errors.value = [];
    warnings.value = [];

    let body: unknown = model.value;
    if (rawMode.value) {
      try {
        body = JSON.parse(rawText.value);
      } catch (err) {
        errors.value = [`Raw JSON does not parse: ${errorMessage(err)}`];
        return;
      }
    }

    saving.value = true;
    try {
      const res = await apiSend<{ ok: boolean; warnings: string[] }>(
        "PUT",
        "/api/config",
        { baseHash: baseHash.value, config: body },
      );
      warnings.value = res.warnings;
      toast.add({
        severity: "success",
        summary: "Config saved",
        detail: "The running bot will reload it automatically.",
        life: 3000,
      });
      await reload();
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes("changed since you loaded it")) {
        // 409: someone else wrote config.json underneath this editor.
        // Surface it and refresh the baseline so the next save can work
        // once the admin has re-applied their changes.
        errors.value = [message];
        await reload().catch(() => {});
      } else {
        errors.value = parseErrorList(message);
      }
    } finally {
      saving.value = false;
    }
  }

  return {
    placeholder, schema, model, rawMode, rawText, baseHash, errors, warnings, saving,
    load, reload, setTop, save,
  };
}
