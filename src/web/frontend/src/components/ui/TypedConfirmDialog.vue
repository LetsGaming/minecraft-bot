<template>
  <ConfirmDialog :group="TYPED_CONFIRM_GROUP" :style="{ width: '480px', maxWidth: 'calc(100vw - 32px)' }">
    <template #container="{ message, acceptCallback, rejectCallback }">
      <div ref="body" class="tc-body">
        <span :class="['tc-level', `tc-${extras.level}`]">{{ extras.levelLabel || LEVEL_LABEL[extras.level] }}</span>
        <div class="tc-title">
          <ModIcon
            v-if="extras.media"
            :name="extras.media.name"
            :slug="extras.media.slug"
            :src="extras.media.src"
            :size="40"
            decorative
          />
          <h2 ref="heading" class="tc-head">{{ message.header }}</h2>
        </div>
        <InlineBanner v-if="extras.blockedReason" tone="warn">{{ extras.blockedReason }}</InlineBanner>
        <p class="tc-msg">{{ message.message }}</p>
        <dl v-if="extras.facts.length" class="tc-facts">
          <template v-for="fact in extras.facts" :key="fact.term">
            <dt>{{ fact.term }}</dt>
            <dd :class="{ mono: fact.mono }">{{ fact.detail }}</dd>
          </template>
        </dl>
        <template v-if="typing">
          <label class="tc-label" for="typed-confirm">
            <template v-if="extras.typedLabel">{{ extras.typedLabel }}</template>
            <template v-else>
              {{ t("ui.confirm.typeBefore") }} <code class="mono">{{ typedExpected }}</code> {{ t("ui.confirm.typeAfter") }}
            </template>
          </label>
          <InputText
            id="typed-confirm"
            v-model="typed"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            autofocus
            class="tc-input mono tap"
            @keydown.enter="matches && acceptCallback()"
          />
        </template>
        <div class="tc-actions">
          <Button
            v-if="extras.level !== 'inform'"
            class="tap"
            :label="message.rejectLabel || t('ui.confirm.cancel')"
            severity="secondary"
            text
            :autofocus="!typing"
            @click="rejectCallback"
          />
          <Button
            v-if="extras.alternateLabel"
            class="tap"
            :label="extras.alternateLabel"
            severity="secondary"
            outlined
            @click="alternate(rejectCallback)"
          />
          <Button
            class="tap"
            :label="message.acceptLabel"
            :severity="SEVERITY[extras.tone]"
            :autofocus="extras.level === 'inform'"
            :disabled="!canAccept"
            @click="acceptCallback"
          />
        </div>
      </div>
    </template>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ConfirmDialog from "primevue/confirmdialog";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import InlineBanner from "./InlineBanner.vue";
import ModIcon from "./ModIcon.vue";
import { t } from "../../i18n";
import {
  TYPED_CONFIRM_GROUP,
  confirmExtras,
  typedExpected,
  typedNonce,
  type ConfirmLevel,
  type ConfirmTone,
} from "../../composables/useTypedConfirm";

const LEVEL_LABEL: Record<ConfirmLevel, string> = {
  inform: "Notice",
  disruptive: "Interrupts players",
  irreversible: "Irreversible",
};

const SEVERITY: Record<ConfirmTone, "primary" | "warn" | "danger"> = {
  primary: "primary",
  warn: "warn",
  danger: "danger",
};

const typed = ref("");
const body = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const extras = confirmExtras;

const typing = computed(
  () => extras.value.level === "irreversible" && !extras.value.blockedReason && typedExpected.value !== "",
);
const matches = computed(
  () => typedExpected.value !== "" && typed.value.trim() === typedExpected.value,
);
const canAccept = computed(() => {
  if (extras.value.blockedReason) return false;
  return typing.value ? matches.value : true;
});

function alternate(close: () => void): void {
  const handler = extras.value.onAlternate;
  handler?.();
  close();
}

// PrimeVue labels the dialog by a header element it does not render when the
// container slot is used, so the heading here takes over that id.
function nameDialog(): void {
  const dialog = body.value?.closest('[role="dialog"], [role="alertdialog"]');
  const id = dialog?.getAttribute("aria-labelledby");
  if (id && heading.value) heading.value.id = id;
}

watch(typedNonce, async () => {
  typed.value = "";
  await nextTick();
  nameDialog();
});
watch(body, (el) => {
  if (el) nameDialog();
});
</script>

<style scoped>
.tc-body { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
.tc-level {
  align-self: flex-start;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-dim);
}
.tc-irreversible { color: var(--danger); }
.tc-disruptive { color: var(--st-degraded); }
.tc-title { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.tc-head { margin: 0; font-size: var(--text-xl); font-weight: 600; overflow-wrap: anywhere; }
.tc-msg { margin: 0; white-space: pre-line; max-width: 64ch; }
.tc-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg);
  font-size: var(--text-sm);
}
.tc-facts dt { color: var(--text-dim); }
.tc-facts dd { margin: 0; overflow-wrap: anywhere; }
.tc-label { font-size: var(--text-sm); color: var(--text-dim); }
.tc-label code { color: var(--text); }
.tc-input { width: 100%; }
.tc-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
@media (max-width: 480px) {
  .tc-facts { grid-template-columns: minmax(0, 1fr); gap: 0 var(--space-4); }
  .tc-facts dd { margin-bottom: var(--space-2); }
}
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
}
</style>
