<template>
  <ConfirmDialog :group="TYPED_CONFIRM_GROUP" :style="{ width: '440px', maxWidth: '94vw' }">
    <template #container="{ message, acceptCallback, rejectCallback }">
      <div class="tc-body">
        <h3 class="tc-head">
          <i class="pi pi-exclamation-triangle" /> {{ message.header }}
        </h3>
        <p class="tc-msg">{{ message.message }}</p>
        <label class="tc-label small muted" for="typed-confirm">
          Type <code class="mono">{{ typedExpected }}</code> to confirm
        </label>
        <InputText
          id="typed-confirm"
          v-model="typed"
          autocomplete="off"
          class="tc-input"
          @keydown.enter="matches && acceptCallback()"
        />
        <div class="tc-actions">
          <Button label="Cancel" severity="secondary" text @click="rejectCallback" />
          <Button
            :label="message.acceptLabel"
            severity="danger"
            :disabled="!matches"
            @click="acceptCallback"
          />
        </div>
      </div>
    </template>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ConfirmDialog from "primevue/confirmdialog";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import { TYPED_CONFIRM_GROUP, typedExpected, typedNonce } from "../../composables/useTypedConfirm";

const typed = ref("");
const matches = computed(
  () => typedExpected.value !== "" && typed.value.trim() === typedExpected.value,
);
watch(typedNonce, () => {
  typed.value = "";
});
</script>

<style scoped>
.tc-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; }
.tc-head { margin: 0; font-size: 16px; font-weight: 500; display: flex; align-items: center; gap: 8px; }
.tc-msg { margin: 0; white-space: pre-line; }
.tc-input { width: 100%; }
.tc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
</style>
