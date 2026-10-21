<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('rewards.impact.title')"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <p class="si-lede">{{ t("rewards.impact.lede") }}</p>

    <section v-for="server in servers" :key="server.serverId" class="si-server">
      <h3 class="si-name">
        {{ t("rewards.scopeServer", { server: server.serverId }) }}
        <span v-if="!server.hasOverride" class="si-tag">{{ t("rewards.impact.followsAll") }}</span>
      </h3>
      <p v-if="!server.canEdit" class="si-note">{{ t("rewards.impact.cannotEdit") }}</p>

      <ul class="si-list">
        <li v-for="change in server.changes" :key="changeKey(change)" class="si-item">
          <div class="si-text">
            <span class="si-kind">{{ t(`rewards.impact.kind.${change.kind}`) }}</span>
            <span>{{ describe(change) }}</span>
            <span class="si-where">{{ whereText(change.where) }}</span>
          </div>
          <div class="si-choice">
            <Checkbox
              v-model="choices[choiceKey(server.serverId, change)]"
              binary
              :input-id="inputId(server.serverId, change)"
              :disabled="!server.canEdit"
            />
            <label :for="inputId(server.serverId, change)">
              {{ change.kind === "added" ? t("rewards.impact.exclude") : t("rewards.impact.keep") }}
            </label>
          </div>
        </li>
      </ul>

      <p v-for="orphan in server.orphans" :key="`${orphan.where}|${orphan.id}`" class="si-orphan">
        {{ t("rewards.impact.orphan", { item: orphan.item ? itemName(catalog, orphan.item) : orphan.id }) }}
      </p>
    </section>

    <template #footer>
      <Button
        :label="t('review.close')"
        severity="secondary"
        outlined
        class="tap"
        :disabled="saving"
        @click="$emit('update:visible', false)"
      />
      <Button
        :label="t('rewards.impact.save')"
        icon="pi pi-check"
        class="tap"
        :loading="saving"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { reactive, watch } from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import { weightOf, type ListSelection, type ServerImpact, type ServerSelection, type SharedChange } from "@mcbot/schema/dailyRewards.js";
import type { ItemCatalog } from "../../utils/minecraftItems";
import { itemName, stackText } from "../../utils/rewardDisplay";
import { t } from "../../i18n";

/**
 * Shown before the shared pool is saved when servers inherit what is about to
 * change. Each server's change is followed by default; ticking a box writes an
 * exception into that server's file instead: keep the entry as it is (a
 * removed or changed one), or leave a new one out.
 */
const props = defineProps<{
  visible: boolean;
  servers: ServerImpact[];
  catalog: ItemCatalog | null;
  saving?: boolean;
}>();
const emit = defineEmits<{
  "update:visible": [open: boolean];
  confirm: [selections: Record<string, ServerSelection>];
}>();

const choices = reactive<Record<string, boolean>>({});

watch(
  () => props.servers,
  () => {
    for (const key of Object.keys(choices)) delete choices[key];
  },
);

const changeKey = (c: SharedChange): string => `${c.where}|${c.kind}|${c.id}`;
const choiceKey = (serverId: string, c: SharedChange): string => `${serverId}|${changeKey(c)}`;
const inputId = (serverId: string, c: SharedChange): string => `rw-impact-${serverId}-${changeKey(c)}`.replace(/[^\w-]/g, "_");

function whereText(where: string): string {
  return where === "default" ? t("rewards.impact.inPool") : t("rewards.impact.inDay", { day: where.slice("streakBonuses.".length) });
}

function describe(change: SharedChange): string {
  const entry = change.after ?? change.before!;
  const name = stackText(props.catalog, entry);
  if (change.kind !== "changed") return change.where === "default" ? `${name}, ${t("rewards.weightIs", { weight: weightOf(entry) })}` : name;
  const before = change.before!;
  const after = change.after!;
  const parts: string[] = [];
  if (before.amount !== after.amount) parts.push(`${t("rewards.col.amount")} ${before.amount} → ${after.amount}`);
  if (change.where === "default" && weightOf(before) !== weightOf(after)) {
    parts.push(`${t("rewards.impact.weight")} ${weightOf(before)} → ${weightOf(after)}`);
  }
  return `${itemName(props.catalog, after.item)}: ${parts.join(", ") || name}`;
}

function add(selection: ListSelection, change: SharedChange): void {
  if (change.where === "default") (selection.pool ??= []).push(change.id);
  else ((selection.days ??= {})[change.where.slice("streakBonuses.".length)] ??= []).push(change.id);
}

function confirm(): void {
  const out: Record<string, ServerSelection> = {};
  for (const server of props.servers) {
    if (!server.canEdit) continue;
    const selection: ServerSelection = {};
    for (const change of server.changes) {
      if (!choices[choiceKey(server.serverId, change)]) continue;
      if (change.kind === "added") add((selection.exclude ??= {}), change);
      else add((selection.keep ??= {}), change);
    }
    if (selection.keep || selection.exclude) out[server.serverId] = selection;
  }
  emit("confirm", out);
}
</script>

<style scoped>
.si-lede { margin: 0 0 var(--space-3); color: var(--text-dim); max-width: 64ch; }
.si-server { padding: var(--space-3) 0; border-top: 1px solid var(--border); }
.si-name { margin: 0 0 var(--space-2); font-size: var(--text-base, 1rem); font-weight: 600; display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.si-tag { font-size: var(--text-xs); font-weight: 400; color: var(--text-dim); border: 1px solid var(--border-strong); border-radius: var(--radius-full); padding: 0 var(--space-2); }
.si-note { margin: 0 0 var(--space-2); color: var(--text-dim); font-size: var(--text-sm); }
.si-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.si-item { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2) var(--space-4); align-items: center; }
.si-text { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: baseline; min-width: 0; }
.si-kind { font-weight: 600; }
.si-where { color: var(--text-dim); font-size: var(--text-sm); }
.si-choice { display: flex; align-items: center; gap: var(--space-2); }
.si-orphan { margin: var(--space-2) 0 0; color: var(--text); font-size: var(--text-sm); padding: var(--space-2) var(--space-3); border: 1px solid var(--accent); border-radius: var(--radius-control); }
</style>
