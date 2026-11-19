<template>
  <div class="tp">
    <div class="tp-head">
      <h3 class="tp-title">{{ t("rewards.tiers.title") }}</h3>
      <Button
        v-if="editable && !rewards.isShared.value && rewards.overrides('tierChances')"
        class="tap"
        icon="pi pi-undo"
        :label="t('rewards.resetToShared')"
        severity="secondary"
        text
        @click="rewards.resetField('tierChances')"
      />
      <Button
        v-if="editable"
        class="tap"
        icon="pi pi-replay"
        :label="t('rewards.tiers.reset')"
        severity="secondary"
        outlined
        size="small"
        @click="rewards.setTierChances({ ...DEFAULT_TIER_CHANCES })"
      />
    </div>
    <ul class="tp-list">
      <li v-for="tier in tiers" :key="tier" class="tp-row" :style="{ '--rarity': rarityColor(tier) }">
        <label :for="`rw-tier-${tier}`" class="tp-label">
          <span class="tp-pip" aria-hidden="true" />{{ rarityLabel(tier) }}
        </label>
        <InputNumber
          :input-id="`rw-tier-${tier}`"
          :locale="UI_LOCALE"
          :model-value="chances[tier]"
          :min="0"
          :max="100"
          :max-fraction-digits="2"
          suffix=" %"
          :disabled="!editable"
          class="tp-input"
          @update:model-value="onEdit(tier, $event)"
        />
        <span v-if="!hasEntries(tier)" class="tp-note">{{ t("rewards.tiers.empty") }}</span>
      </li>
    </ul>
    <p class="tp-total" :class="{ 'is-bad': problem }" role="status">
      {{ problem ?? t("rewards.tiers.total", { total }) }}
    </p>
    <p v-if="!rewards.isShared.value && !rewards.overrides('tierChances')" class="tp-note">{{ t("rewards.inheritedValue") }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import { DEFAULT_TIER_CHANCES, rarityOf } from "@mcbot/schema/dailyRewards.js";
import type { RewardRarity } from "@mcbot/schema/embedCategories.js";
import { useRewardsContext } from "../../composables/rewardsContext";
import { REWARD_RARITIES, rarityColor, rarityLabel, tierChancesProblem, tierTotal } from "../../utils/rewardDisplay";
import { t, UI_LOCALE } from "../../i18n";

/**
 * The chance that a claim rolls each tier, in percent. The draft keeps a
 * total that is not 100 so the admin can type their way there; saving waits
 * until it adds up.
 */
const { rewards, editable } = useRewardsContext();

const tiers = REWARD_RARITIES;
const chances = computed(() => rewards.tierChances.value);
const total = computed(() => tierTotal(chances.value));
const problem = computed(() => tierChancesProblem(chances.value));
const filled = computed(() => new Set((rewards.effectivePool.value.default ?? []).map((item) => rarityOf(item))));

const hasEntries = (tier: RewardRarity): boolean => filled.value.has(tier);

function onEdit(tier: RewardRarity, value: number | null): void {
  if (value === null) return;
  rewards.setTierChances({ ...chances.value, [tier]: Math.min(Math.max(value, 0), 100) });
}
</script>

<style scoped>
.tp { display: grid; gap: var(--space-3); }
.tp-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.tp-title { margin: 0; font-weight: 600; margin-right: auto; }
.tp-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.tp-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.tp-label { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 12ch; font-weight: 600; }
.tp-pip { width: 8px; height: 8px; border-radius: 2px; background: var(--rarity); }
.tp-input { width: 12ch; }
.tp-input :deep(input) { width: 100%; }
.tp-total { margin: 0; font-weight: 600; }
.tp-total.is-bad { color: var(--danger); }
.tp-note { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
</style>
