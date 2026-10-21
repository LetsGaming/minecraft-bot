<template>
  <section class="cp" :aria-label="t('rewards.preview.title')">
    <div class="cp-controls">
      <label for="rw-preview-day" class="cp-label">{{ t("rewards.preview.day") }}</label>
      <InputNumber
        v-model="day"
        input-id="rw-preview-day"
        :locale="UI_LOCALE"
        :min="1"
        :max="999999"
        show-buttons
        class="cp-day"
      />
      <Button class="tap" icon="pi pi-refresh" :label="t('rewards.preview.roll')" @click="roll" />
    </div>
    <p v-if="!pool.default?.length" class="cp-note">{{ t("rewards.preview.noPool") }}</p>
    <ul v-else-if="result" class="cp-result" role="status" aria-live="polite">
      <li class="cp-line">
        <span class="cp-kind">{{ t("rewards.preview.main") }}</span>
        <strong>{{ stackText(catalog, result.main) }}</strong>
        <span class="cp-rarity">{{ rarityLabel(rarityOf(result.main, pool.default)) }}</span>
      </li>
      <li v-if="result.randomBonus" class="cp-line">
        <span class="cp-kind">{{ t("rewards.preview.lucky") }}</span>
        <strong>{{ stackText(catalog, result.randomBonus) }}</strong>
      </li>
      <li v-for="(item, i) in result.streakBonus" :key="i" class="cp-line">
        <span class="cp-kind">{{ t("rewards.preview.milestone", { day: day ?? 1 }) }}</span>
        <strong>{{ stackText(catalog, item) }}</strong>
      </li>
      <li v-if="!result.randomBonus && result.streakBonus.length === 0" class="cp-line cp-quiet">
        {{ t("rewards.preview.nothingExtra") }}
      </li>
    </ul>
    <p v-else class="cp-note">{{ t("rewards.preview.hint") }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import { rarityOf, type RewardPool } from "@mcbot/schema/dailyRewards.js";
import { rollRewards, type Rng, type RolledRewards } from "@mcbot/schema/rewardRoll.js";
import type { ItemCatalog } from "../../utils/minecraftItems";
import { rarityLabel, stackText } from "../../utils/rewardDisplay";
import { t, UI_LOCALE } from "../../i18n";

/**
 * Roll one claim from the pool as it is now, unsaved edits included, with the
 * same draw the bot uses. The streak day picks which milestone bonus applies.
 */
const props = defineProps<{
  pool: RewardPool;
  catalog: ItemCatalog | null;
  /** Replaces Math.random, for a repeatable roll. */
  rng?: Rng;
}>();

const day = ref<number | null>(1);
const result = ref<RolledRewards | null>(null);

function roll(): void {
  const items = props.pool.default;
  if (!items?.length) return;
  result.value = rollRewards({ ...props.pool, default: items }, day.value ?? 1, props.rng);
}
</script>

<style scoped>
.cp { display: grid; gap: var(--space-3); }
.cp-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.cp-label { font-weight: 600; }
.cp-day { width: 9ch; }
.cp-day :deep(input) { width: 100%; }
.cp-note { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
.cp-result { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.cp-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); }
.cp-kind { color: var(--text-dim); font-size: var(--text-sm); min-width: 11ch; }
.cp-rarity { color: var(--text-dim); font-size: var(--text-sm); }
.cp-quiet { color: var(--text-dim); }
</style>
