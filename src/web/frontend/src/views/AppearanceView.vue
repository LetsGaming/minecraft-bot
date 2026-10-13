<template>
  <div class="appearance-view">
    <ViewHeader :title="t('appearance.title')" :subtitle="t('appearance.lede')" />

    <p v-if="!ready && !loadError" class="ap-note" role="status">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("appearance.loading") }}
    </p>

    <InlineError
      v-else-if="!ready"
      :title="t('appearance.loadFailed')"
      :recovery="t('appearance.loadFailedRecovery')"
      :detail="loadError"
      :busy="loading"
      :heading-level="2"
      @retry="load"
    />

    <EditorShell v-else :state="editorState">
      <template #banners>
        <InlineBanner v-if="bannerErrors.length" tone="danger" :title="t('appearance.saveFailedTitle')">
          <ul class="ap-list">
            <li v-for="(line, i) in bannerErrors" :key="i">{{ line }}</li>
          </ul>
        </InlineBanner>
      </template>

      <template #conflict>
        <ConflictPicker :conflicts="conflicts" @resolve="resolveConflict($event.conflict, $event.choice)" />
      </template>
      <template #conflict-actions>
        <Button
          class="tap"
          :label="t('appearance.dropMine')"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          @click="reloadDiscardingMine"
        />
      </template>

      <template #bar>
        <EditBar
          :state="editorState"
          :change-count="pendingCount()"
          :conflict-count="conflicts.length"
          :can-save="!stale && allValid"
          :save-hint="t('appearance.saveHint')"
          :saving-hint="t('appearance.savingHint')"
          @save="save"
          @discard="discard"
        >
          <template #extra>
            <Button
              class="tap"
              :label="t('appearance.resetAll')"
              icon="pi pi-undo"
              size="small"
              severity="secondary"
              outlined
              :disabled="Object.keys(colors).length === 0"
              @click="resetAll"
            />
          </template>
        </EditBar>
      </template>

      <template #default="{ locked }">
        <section v-for="group in groups" :key="group.id" class="ap-group">
          <h2>{{ t(group.titleKey) }}</h2>
          <ul class="ap-rows">
            <li v-for="key in group.keys" :key="key" class="ap-row">
              <div class="ap-edit">
                <label :for="`ap-hex-${key}`" class="ap-label">{{ t(labelKey(key)) }}</label>
                <div class="ap-inputs">
                  <ColorPicker
                    :model-value="effectiveHex(key).slice(1)"
                    format="hex"
                    :disabled="locked"
                    :aria-label="t('appearance.pick', { name: t(labelKey(key)) })"
                    @update:model-value="onPick(key, $event)"
                  />
                  <InputText
                    :id="`ap-hex-${key}`"
                    :model-value="shown(key)"
                    :invalid="!isValid(key)"
                    :disabled="locked"
                    maxlength="7"
                    spellcheck="false"
                    class="ap-hex"
                    @update:model-value="onType(key, $event)"
                  />
                  <Button
                    class="tap"
                    icon="pi pi-undo"
                    severity="secondary"
                    text
                    :disabled="locked || !isOverridden(key)"
                    :aria-label="t('appearance.resetOne', { name: t(labelKey(key)) })"
                    @click="reset(key)"
                  />
                </div>
                <p v-if="!isValid(key)" class="ap-warn" role="alert">{{ t("appearance.invalid") }}</p>
                <p v-else-if="lowContrastOn(key).length" class="ap-warn">
                  {{ t("appearance.lowContrast") }}
                </p>
              </div>
              <div class="ap-previews">
                <EmbedPreview
                  v-for="mode in modes"
                  :key="mode"
                  :mode="mode"
                  :color="effectiveHex(key)"
                  :icon="iconOf(key)"
                  :title="t(labelKey(key))"
                  :text="t('appearance.sampleText')"
                  :field="t('appearance.sampleField')"
                />
              </div>
            </li>
          </ul>
        </section>
      </template>
    </EditorShell>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import ColorPicker from "primevue/colorpicker";
import InputText from "primevue/inputtext";
import {
  CATEGORY_STYLE,
  EMBED_CATEGORIES,
  parseHexColor,
  RARITY_STYLE,
  REWARD_RARITIES,
  type EmbedCategory,
  type EmbedColorKey,
  type RewardRarity,
} from "@mcbot/schema/embedCategories.js";
import { useEmbedColors } from "../composables/useEmbedColors";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EditorShell from "../components/ui/EditorShell.vue";
import EditBar from "../components/ui/EditBar.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import InlineError from "../components/ui/InlineError.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import EmbedPreview from "../components/EmbedPreview.vue";
import type { EditorState } from "../components/ui/types";
import { t, type MessageKey } from "../i18n";

const {
  loadError, loading, ready, saving, stale, conflicts, saveFailure, colors, dirty,
  pendingCount, load, discard, effectiveHex, isOverridden, isValid, set, reset, resetAll,
  lowContrastOn, save, resolveConflict, reloadDiscardingMine,
} = useEmbedColors();

const modes = ["dark", "light"] as const;

/** Half-typed text per key; the colour only changes once it is complete. */
const typing = ref<Record<string, string>>({});

const groups: Array<{ id: string; titleKey: MessageKey; keys: EmbedColorKey[] }> = [
  { id: "categories", titleKey: "appearance.groupCategories", keys: [...EMBED_CATEGORIES] },
  {
    id: "rarities",
    titleKey: "appearance.groupRarities",
    keys: REWARD_RARITIES.map((r): EmbedColorKey => `rarity.${r}`),
  },
];

const editorState = computed<EditorState>(() => {
  if (saving.value) return "saving";
  if (conflicts.value.length > 0) return "conflict";
  if (dirty.value) return "dirty";
  return "clean";
});

const bannerErrors = computed(() => (conflicts.value.length > 0 ? [] : saveFailure.value));
const allValid = computed(() => groups.every((g) => g.keys.every((k) => isValid(k))));

function labelKey(key: EmbedColorKey): MessageKey {
  return `appearance.key.${key}` as MessageKey;
}

function iconOf(key: EmbedColorKey): string {
  return key.startsWith("rarity.")
    ? RARITY_STYLE[key.slice("rarity.".length) as RewardRarity].icon
    : CATEGORY_STYLE[key as EmbedCategory].icon;
}

function shown(key: EmbedColorKey): string {
  return typing.value[key] ?? effectiveHex(key);
}

function onPick(key: EmbedColorKey, value: unknown): void {
  if (typeof value !== "string") return;
  delete typing.value[key];
  set(key, value);
}

function onType(key: EmbedColorKey, value: string | undefined): void {
  const text = (value ?? "").trim();
  const withHash = text.startsWith("#") ? text : `#${text}`;
  if (parseHexColor(withHash) !== undefined) {
    delete typing.value[key];
    set(key, withHash);
  } else {
    typing.value[key] = text;
  }
}

onMounted(load);
</script>

<style scoped>
.ap-note {
  color: var(--text-muted);
}
.ap-list {
  margin: 0;
  padding-left: var(--space-4);
}
.ap-group h2 {
  font-size: var(--text-xl);
  margin: var(--space-5) 0 var(--space-3);
}
.ap-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}
.ap-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
  gap: var(--space-4);
  align-items: start;
}
.ap-label {
  display: block;
  font-weight: 600;
  margin-bottom: var(--space-2);
}
.ap-inputs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ap-hex {
  width: 11ch;
  font-family: var(--font-mono);
}
.ap-warn {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--st-degraded, inherit);
}
.ap-previews {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
@media (max-width: 720px) {
  .ap-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .ap-previews {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
