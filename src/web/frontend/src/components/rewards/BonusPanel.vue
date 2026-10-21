<template>
  <div class="bp">
    <div class="bp-row">
      <label for="rw-bonus" class="bp-label">{{ t("rewards.bonus.title") }}</label>
      <InputNumber
        input-id="rw-bonus"
        :locale="UI_LOCALE"
        :model-value="rewards.bonusChance.value"
        :min="0"
        :max="100"
        :max-fraction-digits="2"
        suffix=" %"
        :disabled="!editable"
        class="bp-input"
        @update:model-value="rewards.setBonusChance($event)"
      />
      <Button
        v-if="editable && !rewards.isShared.value && rewards.overrides('bonusChance')"
        class="tap"
        icon="pi pi-undo"
        :label="t('rewards.resetToShared')"
        severity="secondary"
        text
        @click="rewards.resetField('bonusChance')"
      />
    </div>
    <p class="bp-text">{{ text }}</p>
    <p v-if="!rewards.isShared.value && !rewards.overrides('bonusChance')" class="bp-note">{{ t("rewards.inheritedValue") }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import { useRewardsContext } from "../../composables/rewardsContext";
import { t, UI_LOCALE } from "../../i18n";

/** The chance of a second, extra draw on any claim, said in plain words. */
const { rewards, editable } = useRewardsContext();

const text = computed(() => {
  const chance = rewards.bonusChance.value;
  if (chance <= 0) return t("rewards.bonus.off");
  return t("rewards.bonus.oneIn", { count: Math.max(1, Math.round(100 / chance)) });
});
</script>

<style scoped>
.bp { display: grid; gap: var(--space-2); }
.bp-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.bp-label { font-weight: 600; }
.bp-input { width: 12ch; }
.bp-input :deep(input) { width: 100%; }
.bp-text { margin: 0; }
.bp-note { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
</style>
