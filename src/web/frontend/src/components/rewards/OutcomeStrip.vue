<template>
  <section class="os" :aria-label="t('rewards.outcome.title')">
    <div class="os-head">
      <h2 class="os-title">{{ t("rewards.outcome.title") }}</h2>
      <Button
        class="tap"
        :icon="previewOpen ? 'pi pi-chevron-up' : 'pi pi-play'"
        :label="t('rewards.preview.title')"
        severity="secondary"
        outlined
        size="small"
        :aria-expanded="previewOpen ? 'true' : 'false'"
        aria-controls="rw-preview"
        @click="previewOpen = !previewOpen"
      />
    </div>
    <p v-if="items.length === 0" class="os-note">{{ t("rewards.pool.empty") }}</p>
    <template v-else>
      <StackedBar :segments="segments" :label="t('rewards.outcome.barLabel')" />
      <p class="os-note">{{ summary }}</p>
    </template>
    <div v-if="previewOpen" id="rw-preview" class="os-preview">
      <ClaimPreview :pool="rewards.effectivePool.value" :catalog="catalog" :rng="rng" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import { rarityOf, totalWeight, weightOf } from "@mcbot/schema/dailyRewards.js";
import type { Rng } from "@mcbot/schema/rewardRoll.js";
import { useRewardsContext } from "../../composables/rewardsContext";
import { REWARD_RARITIES, formatPercent, rarityColor, rarityLabel } from "../../utils/rewardDisplay";
import StackedBar, { type BarSegment } from "../ui/StackedBar.vue";
import ClaimPreview from "./ClaimPreview.vue";
import { t } from "../../i18n";

/**
 * What players actually get: the chance of each rarity as one bar, and a
 * preview that rolls a claim from the draft. Always on screen, so a weight
 * change shows its effect without scrolling.
 */
defineProps<{ rng?: Rng }>();

const { rewards, catalog } = useRewardsContext();
const previewOpen = ref(false);

const items = computed(() => rewards.effectivePool.value.default ?? []);

const segments = computed<BarSegment[]>(() => {
  const total = totalWeight(items.value);
  return REWARD_RARITIES.map((rarity) => {
    const weight = items.value
      .filter((item) => rarityOf(item, items.value) === rarity)
      .reduce((sum, item) => sum + weightOf(item), 0);
    const share = total > 0 ? (weight / total) * 100 : 0;
    return {
      key: rarity,
      label: rarityLabel(rarity),
      share,
      text: `${formatPercent(share)} %`,
      color: rarityColor(rarity),
    };
  });
});

const summary = computed(() => {
  const chance = rewards.bonusChance.value;
  const parts = [t("rewards.outcome.items", { count: items.value.length })];
  if (chance > 0) parts.push(t("rewards.outcome.bonus", { count: Math.max(1, Math.round(100 / chance)) }));
  return parts.join(" · ");
});
</script>

<style scoped>
.os { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-surface); }
.os-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.os-title { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.os-note { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
.os-preview { padding-top: var(--space-3); border-top: 1px solid var(--border); }
</style>
