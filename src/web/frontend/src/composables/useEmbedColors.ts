import { computed } from "vue";
import { useToast } from "primevue/usetoast";
import { apiGet, apiSend } from "../api";
import type { ConfigResponse } from "../api";
import { isRecord } from "../utils/isRecord";
import { useEditableDocument, type DocUnits } from "./useEditableDocument";
import {
  colorToHex,
  contrastRatio,
  defaultEmbedColor,
  DISCORD_EMBED_BACKGROUND,
  EMBED_CATEGORIES,
  MIN_BAR_CONTRAST,
  parseHexColor,
  REWARD_RARITIES,
  type EmbedColorKey,
} from "@mcbot/schema/embedCategories.js";
import { t } from "../i18n";

interface ColorsDoc {
  embedColors: Record<string, string>;
}

/** One tracked unit per colour key, the grain a person edits. */
const colorUnits: DocUnits<ColorsDoc> = {
  read: (doc) => ({ ...doc.embedColors }),
  write(doc, key, value) {
    if (value === undefined) delete doc.embedColors[key];
    else doc.embedColors[key] = String(value);
  },
};

export const COLOR_KEYS: readonly EmbedColorKey[] = [
  ...EMBED_CATEGORIES,
  ...REWARD_RARITIES.map((r): EmbedColorKey => `rarity.${r}`),
];

/** Editing the `embedColors` override map of config.json. */
export function useEmbedColors() {
  const toast = useToast();

  const editor = useEditableDocument<ColorsDoc>(
    {
      async load() {
        const res = await apiGet<ConfigResponse>("/api/config");
        const config = isRecord(res.config) ? res.config : {};
        const colors = isRecord(config.embedColors) ? config.embedColors : {};
        const embedColors: Record<string, string> = {};
        for (const [key, value] of Object.entries(colors)) {
          if (typeof value === "string") embedColors[key] = value;
        }
        return { doc: { embedColors }, token: res.hash };
      },
      async save({ token, draft }) {
        // Built from the current file, guarded by the hash from the load.
        const res = await apiGet<ConfigResponse>("/api/config");
        const config = isRecord(res.config) ? res.config : {};
        if (Object.keys(draft.embedColors).length > 0) config.embedColors = draft.embedColors;
        else delete config.embedColors;
        return apiSend<{ warnings?: string[] }>("PUT", "/api/config", { baseHash: token, config });
      },
    },
    { units: colorUnits },
  );

  const colors = computed(() => editor.draft.value?.embedColors ?? {});

  /** The colour in effect: the valid override, else the built-in default. */
  function effective(key: EmbedColorKey): number {
    return parseHexColor(colors.value[key]) ?? defaultEmbedColor(key);
  }

  function effectiveHex(key: EmbedColorKey): string {
    return colorToHex(effective(key));
  }

  function isOverridden(key: EmbedColorKey): boolean {
    return colors.value[key] !== undefined;
  }

  /** Whether the text typed for a key is a complete, valid colour. */
  function isValid(key: EmbedColorKey): boolean {
    const v = colors.value[key];
    return v === undefined || parseHexColor(v) !== undefined;
  }

  function set(key: EmbedColorKey, hex: string): void {
    const doc = editor.draft.value;
    if (!doc) return;
    const value = hex.startsWith("#") ? hex : `#${hex}`;
    // Back to the default is the same as no override.
    if (parseHexColor(value) === defaultEmbedColor(key)) delete doc.embedColors[key];
    else doc.embedColors[key] = value.toLowerCase();
  }

  function reset(key: EmbedColorKey): void {
    if (editor.draft.value) delete editor.draft.value.embedColors[key];
  }

  function resetAll(): void {
    if (editor.draft.value) editor.draft.value.embedColors = {};
  }

  /** Which card backgrounds this colour nearly disappears into. */
  function lowContrastOn(key: EmbedColorKey): Array<"dark" | "light"> {
    const color = effective(key);
    return (["dark", "light"] as const).filter(
      (mode) => contrastRatio(color, DISCORD_EMBED_BACKGROUND[mode]) < MIN_BAR_CONTRAST,
    );
  }

  const saveFailure = computed(() => [
    ...(editor.saveError.value ? [editor.saveError.value] : []),
    ...editor.fieldErrors.value.map((e) => e.replace(/^\s*-\s*/, "")),
  ]);

  async function save(): Promise<boolean> {
    const ok = await editor.save();
    if (ok) {
      toast.add({
        severity: "success",
        summary: t("appearance.savedToast"),
        detail: t("appearance.savedToastDetail"),
        life: 3000,
      });
    }
    return ok;
  }

  return {
    loadError: editor.loadError, loading: editor.loading, ready: editor.ready,
    saving: editor.saving, dirty: editor.dirty, saved: editor.saved,
    stale: editor.stale, conflicts: editor.conflicts, saveFailure, colors,
    pendingCount: () => editor.dirtyKeys.value.length,
    load: async (): Promise<void> => {
      await editor.load();
    },
    discard: (): void => editor.discard(),
    effective, effectiveHex, isOverridden, isValid, set, reset, resetAll, lowContrastOn, save,
    resolveConflict: editor.resolveConflict,
    reloadDiscardingMine: editor.reloadDiscardingMine,
  };
}
