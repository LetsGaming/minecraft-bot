<template>
  <Dialog
    :visible="visible"
    modal
    class="setup-wizard"
    :closable="!writing"
    :style="{ width: '620px', maxWidth: '94vw' }"
    :header="t('wizard.title')"
    @update:visible="$emit('update:visible', $event)"
  >
    <ol class="steps" :aria-label="t('wizard.steps')">
      <li
        v-for="(label, i) in stepLabels"
        :key="i"
        :class="['step', { active: step === i, done: step > i }]"
        :aria-current="step === i ? 'step' : undefined"
      >
        <span class="step-num" aria-hidden="true">
          <i v-if="step > i" class="pi pi-check" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="step-label">{{ label }}</span>
        <span v-if="step > i" class="sr-only">, {{ t("wizard.stepDone") }}</span>
      </li>
    </ol>

    <section v-if="step === 0" class="panel">
      <p v-if="loadingGuilds" class="center" role="status">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("wizard.loadingGuilds") }}
      </p>
      <InlineError
        v-else-if="guildFailure"
        :title="guildFailureCopy.title"
        :recovery="guildFailureCopy.recovery"
        :detail="guildFailureCopy.detail"
        :busy="loadingGuilds"
        @retry="loadGuilds"
      />
      <template v-else>
        <label id="wiz-guild-label" class="field-label" for="wiz-guild">{{ t("wizard.guildLabel") }}</label>
        <Select
          v-model="guildId"
          :options="guildOptions"
          option-label="label"
          option-value="id"
          :placeholder="t('wizard.guildPlaceholder')"
          filter
          label-id="wiz-guild"
          aria-labelledby="wiz-guild-label"
          class="w-full"
          @change="onGuildPicked"
        >
          <template #option="{ option }">
            <span class="guild-opt">
              <span>{{ option.name }}</span>
              <span v-if="option.configured" class="opt-tag">{{ t("wizard.configuredTag") }}</span>
            </span>
          </template>
        </Select>
        <p v-if="seeding" class="hint" role="status">
          <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("wizard.seeding") }}
        </p>
        <InlineError
          v-else-if="seedError"
          class="mt"
          :title="t('wizard.seedFailed')"
          :recovery="t('wizard.seedFailedFix')"
          :detail="seedError"
          @retry="seedFromExisting"
        />
        <p v-else-if="alreadyConfigured" class="hint">
          <i class="pi pi-info-circle" aria-hidden="true" /> {{ t("wizard.alreadyConfigured") }}
        </p>

        <template v-if="sysadmin">
          <label id="wiz-server-label" class="field-label mt" for="wiz-server">{{ t("wizard.serverLabel") }}</label>
          <Select
            v-model="defaultServer"
            :options="serverOptions"
            option-label="label"
            option-value="id"
            :placeholder="serverOptions.length ? t('wizard.serverPlaceholder') : t('wizard.noServers')"
            :disabled="serverOptions.length === 0"
            show-clear
            label-id="wiz-server"
            aria-labelledby="wiz-server-label"
            :pt="{ label: { 'aria-describedby': 'wiz-server-hint' } }"
            class="w-full"
          />
          <p id="wiz-server-hint" class="hint">{{ t("wizard.serverHint") }}</p>
        </template>
      </template>
    </section>

    <section v-else-if="step === 1" class="panel">
      <p v-if="loadingChannels" class="center" role="status">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("wizard.loadingChannels") }}
      </p>
      <InlineError
        v-else-if="channelFailure"
        :title="channelFailureCopy.title"
        :recovery="channelFailureCopy.recovery"
        :detail="channelFailureCopy.detail"
        :busy="loadingChannels"
        @retry="loadChannelsRoles"
      />
      <template v-else>
        <p class="hint top-hint">{{ t("wizard.featuresHint") }}</p>
        <ul class="feature-list">
          <li
            v-for="f in features"
            :key="f.key"
            :class="['feature-row', { on: model[f.key].enabled }]"
          >
            <div class="feature-head">
              <ToggleSwitch
                v-model="model[f.key].enabled"
                :input-id="`wiz-f-${f.key}`"
                :pt="{ input: { 'aria-describedby': `wiz-fh-${f.key}` } }"
              />
              <div class="feature-meta">
                <label class="feature-name" :for="`wiz-f-${f.key}`">
                  <i :class="f.icon" aria-hidden="true" /> {{ f.label }}
                </label>
                <span :id="`wiz-fh-${f.key}`" class="feature-hint">{{ f.hint }}</span>
              </div>
            </div>

            <p v-if="model[f.key].enabled && model[f.key].preserved" class="hint preserved-note">
              <i class="pi pi-lock" aria-hidden="true" /> {{ t("wizard.preserved") }}
            </p>
            <div v-else-if="model[f.key].enabled" class="feature-inputs">
              <Select
                v-if="f.input !== 'enabled' && f.input !== 'role'"
                v-model="model[f.key].channelId"
                :options="channels"
                option-label="name"
                option-value="id"
                filter
                :placeholder="f.input === 'channel+admin' ? t('wizard.appChannel') : t('wizard.channelPlaceholder')"
                :aria-label="f.input === 'channel+admin' ? `${f.label}: ${t('wizard.appChannel')}` : t('wizard.channelFor', { feature: f.label })"
                class="w-full"
              >
                <template #value="{ value, placeholder }">
                  <span v-if="value">#{{ channelName(value) }}</span>
                  <span v-else class="muted">{{ placeholder }}</span>
                </template>
                <template #option="{ option }">#{{ option.name }}</template>
              </Select>

              <Select
                v-if="f.input === 'channel+admin'"
                v-model="model[f.key].adminChannelId"
                :options="channels"
                option-label="name"
                option-value="id"
                filter
                :placeholder="t('wizard.staffChannel')"
                :aria-label="`${f.label}: ${t('wizard.staffChannel')}`"
                class="w-full"
              >
                <template #value="{ value, placeholder }">
                  <span v-if="value">#{{ channelName(value) }}</span>
                  <span v-else class="muted">{{ placeholder }}</span>
                </template>
                <template #option="{ option }">#{{ option.name }}</template>
              </Select>

              <Select
                v-else-if="f.input === 'role'"
                v-model="model[f.key].roleId"
                :options="roles"
                option-label="name"
                option-value="id"
                filter
                :placeholder="t('wizard.rolePlaceholder')"
                :aria-label="t('wizard.roleFor', { feature: f.label })"
                class="w-full"
              >
                <template #option="{ option }">
                  <span class="role-dot" :style="roleDot(option.color)" aria-hidden="true" />{{ option.name }}
                </template>
              </Select>

              <div v-if="f.input === 'channel+webhook'" class="sub-toggle">
                <ToggleSwitch v-model="model[f.key].useWebhook" :input-id="`wiz-wh-${f.key}`" />
                <label :for="`wiz-wh-${f.key}`">{{ t("wizard.useWebhook") }}</label>
              </div>

              <Select
                v-if="f.input === 'channel+interval'"
                v-model="model[f.key].interval"
                :options="intervalOptions"
                option-label="label"
                option-value="value"
                :aria-label="t('wizard.intervalFor', { feature: f.label })"
                class="w-full interval-select"
              />
            </div>
          </li>
        </ul>
      </template>
    </section>

    <section v-else class="panel">
      <p class="hint top-hint">{{ t("wizard.reviewHint") }}</p>
      <dl class="review">
        <div class="review-row">
          <dt>{{ t("wizard.reviewGuild") }}</dt>
          <dd>{{ guildName(guildId) }} <code class="mono id">{{ guildId }}</code></dd>
        </div>
        <div class="review-row">
          <dt>{{ t("wizard.reviewServer") }}</dt>
          <dd>{{ defaultServer || t("wizard.reviewNoServer") }}</dd>
        </div>
        <div v-for="f in enabledFeatures" :key="f.key" class="review-row">
          <dt>{{ f.label }}</dt>
          <dd>{{ reviewValue(f) }}</dd>
        </div>
      </dl>
      <p v-if="enabledFeatures.length === 0" class="hint">{{ t("wizard.reviewNoFeatures") }}</p>
      <InlineError
        v-if="writeError"
        class="mt"
        :title="t('wizard.writeFailed')"
        :retryable="false"
      >
        <span class="pre">{{ writeError }}</span>
        <template v-if="conflicted" #actions>
          <Button
            class="tap"
            :label="t('wizard.reloadLatest')"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            outlined
            :loading="seeding"
            @click="onReloadLatest"
          />
        </template>
      </InlineError>
    </section>

    <template #footer>
      <div class="footer">
        <Button
          v-if="step > 0"
          class="tap"
          :label="t('wizard.back')"
          icon="pi pi-chevron-left"
          text
          severity="secondary"
          :disabled="writing"
          @click="step--"
        />
        <span class="spacer" />
        <Button
          class="tap"
          :label="t('wizard.cancel')"
          severity="secondary"
          text
          :disabled="writing"
          @click="$emit('update:visible', false)"
        />
        <Button
          v-if="step < 2"
          class="tap"
          :label="t('wizard.next')"
          icon="pi pi-chevron-right"
          icon-pos="right"
          :disabled="!canAdvance"
          @click="next"
        />
        <Button
          v-else
          class="tap"
          :label="t('wizard.write')"
          icon="pi pi-check"
          :loading="writing"
          :disabled="!canWrite || conflicted"
          @click="submit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Dialog from "primevue/dialog";
import Select from "primevue/select";
import ToggleSwitch from "primevue/toggleswitch";
import Button from "primevue/button";
import InlineError from "./ui/InlineError.vue";
import { useGuildSetup, FEATURES, type FeatureDesc } from "../composables/useGuildSetup";
import { describeDiscordFailure, type FailureCopy } from "../utils/discordFailure";
import { t } from "../i18n";

export default defineComponent({
  name: "SetupWizard",
  components: { Dialog, Select, ToggleSwitch, Button, InlineError },
  props: {
    visible: { type: Boolean, default: false },
    initialGuildId: { type: String, default: "" },
    sysadmin: { type: Boolean, default: false },
  },
  emits: ["update:visible", "written"],
  setup(props) {
    return { t, ...useGuildSetup(() => props.sysadmin, () => props.initialGuildId) };
  },
  data() {
    return {
      step: 0,
      stepLabels: [t("wizard.stepGuild"), t("wizard.stepFeatures"), t("wizard.stepReview")],
      features: FEATURES,
      intervalOptions: [
        { value: "daily", label: t("wizard.intervalDaily") },
        { value: "weekly", label: t("wizard.intervalWeekly") },
        { value: "monthly", label: t("wizard.intervalMonthly") },
      ],
    };
  },
  computed: {
    guildOptions() {
      // Any guild the bot is in is configurable. A guild's configurability
      // does not depend on the BOT holding Manage Guild (it is invited with
      // a feature permission set that intentionally excludes it); the caller
      // has already been authorized server-side for these guilds. We surface
      // whether each is already configured, and never disable one.
      return this.guilds.map((g) => ({
        id: g.id,
        name: g.name,
        label: g.name,
        configured: this.configuredGuildIds.includes(g.id),
      }));
    },
    serverOptions() {
      return this.configuredServers.map((s) => ({ id: s, label: s }));
    },
    alreadyConfigured(): boolean {
      return !!this.guildId && this.configuredGuildIds.includes(this.guildId);
    },
    enabledFeatures(): FeatureDesc[] {
      return this.features.filter((f) => this.model[f.key].enabled);
    },
    guildFailureCopy(): FailureCopy {
      return describeDiscordFailure(this.guildFailure, this.sysadmin, {
        title: t("guilds.loadFailed"),
        recovery: t("guilds.loadFailedRecovery"),
      });
    },
    channelFailureCopy(): FailureCopy {
      return describeDiscordFailure(this.channelFailure, this.sysadmin, {
        title: t("wizard.channelsFailed"),
        recovery: t("wizard.seedFailedFix"),
      });
    },
    canAdvance(): boolean {
      if (this.step === 0) return !!this.guildId && this.seeded && !this.seeding;
      if (this.step === 1) {
        if (this.loadingChannels || this.channelFailure) return false;
        // every enabled feature that needs a target must have one picked
        return this.enabledFeatures.every((f) => {
          if (f.input === "enabled") return true;
          if (f.input === "role") return !!this.model[f.key].roleId;
          if (f.input === "channel+admin") {
            return !!this.model[f.key].channelId && !!this.model[f.key].adminChannelId;
          }
          return !!this.model[f.key].channelId;
        });
      }
      return true;
    },
  },
  watch: {
    visible(open: boolean) {
      if (open) {
        this.step = 0;
        this.reset();
      }
    },
  },
  methods: {
    async next() {
      if (this.step === 0) {
        // Step 1 shows a failed channel read with Retry, so it opens either way.
        this.step = 1;
        await this.loadChannelsRoles();
        return;
      }
      if (this.step === 1) {
        this.step = 2;
      }
    },
    async onReloadLatest() {
      if (await this.reloadLatest()) this.step = 0;
    },
    async submit() {
      if (await this.write()) {
        this.$emit("written");
        this.$emit("update:visible", false);
      }
    },
    channelName(id: string): string {
      return this.channels.find((c) => c.id === id)?.name ?? id;
    },
    guildName(id: string): string {
      return this.guilds.find((g) => g.id === id)?.name ?? id;
    },
    /** Discord's own role colour; 0 means the role has none. */
    roleDot(color: number) {
      const value = color ? `#${color.toString(16).padStart(6, "0")}` : "var(--text-muted)";
      return { background: value };
    },
    reviewValue(f: FeatureDesc): string {
      const m = this.model[f.key];
      if (f.input === "enabled") return t("wizard.reviewOn");
      if (f.input === "role") {
        return this.roles.find((r) => r.id === m.roleId)?.name ?? m.roleId ?? "";
      }
      const channel = `#${this.channelName(m.channelId ?? "")}`;
      if (f.input === "channel+webhook") return m.useWebhook ? t("wizard.reviewWebhook", { channel }) : channel;
      if (f.input === "channel+interval") {
        const interval = this.intervalOptions.find((o) => o.value === m.interval)?.label ?? m.interval;
        return t("wizard.reviewInterval", { channel, interval });
      }
      if (f.input === "channel+admin") {
        return t("wizard.reviewAdmin", { channel, admin: `#${this.channelName(m.adminChannelId ?? "")}` });
      }
      return channel;
    },
  },
});
</script>

<style scoped>
.steps { display: flex; gap: var(--space-2); margin: 0 0 var(--space-5); padding: 0; list-style: none; }
.step { display: flex; align-items: center; gap: var(--space-2); flex: 1; color: var(--text-dim); font-size: var(--text-sm); min-width: 0; }
.step-num {
  width: 24px; height: 24px; border-radius: 50%; flex: none;
  display: grid; place-items: center; font-size: var(--text-xs);
  background: var(--surface-raised); color: var(--text-dim);
  border: 1px solid var(--border-strong);
}
.step.active .step-num { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.step.active { color: var(--text); font-weight: 500; }
.step.done .step-num { background: var(--accent-tint); color: var(--accent); border-color: var(--accent-border); }

.panel { min-height: 260px; }
.center { display: flex; justify-content: center; align-items: center; gap: var(--space-2); padding: 70px 0; margin: 0; color: var(--text-dim); text-align: center; }

.field-label { display: block; font-size: var(--text-sm); font-weight: 500; margin-bottom: 6px; }
.field-label.mt { margin-top: var(--space-5); }
.w-full { width: 100%; }
.hint { color: var(--text-dim); font-size: var(--text-sm); line-height: var(--leading-body); margin: var(--space-2) 0 0; max-width: 64ch; }
.top-hint { margin: 0 0 var(--space-3); }
.mt { margin-top: var(--space-3); }
.pre { white-space: pre-line; }

.guild-opt { display: flex; align-items: center; gap: var(--space-2); justify-content: space-between; width: 100%; }
.opt-tag {
  padding: 1px 6px;
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  color: var(--text-dim);
  font-size: var(--text-xs);
}

.feature-list {
  display: flex; flex-direction: column; gap: var(--space-2);
  max-height: 380px; overflow-y: auto; margin: 0; padding: 0 4px 0 0; list-style: none;
}
.feature-row {
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  padding: var(--space-3);
  transition: border-color var(--dur-fast);
}
.feature-row.on { border-color: var(--accent-border); }
.feature-head { display: flex; align-items: flex-start; gap: var(--space-3); }
.feature-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.feature-name { font-size: var(--text-sm); font-weight: 500; display: flex; align-items: center; gap: var(--space-2); cursor: pointer; }
.feature-name i { color: var(--accent); font-size: var(--text-sm); }
.feature-hint { color: var(--text-dim); font-size: var(--text-sm); line-height: 1.4; }
.preserved-note { margin: var(--space-2) 0 0; }
.feature-inputs { margin-top: var(--space-3); padding-left: 45px; display: flex; flex-direction: column; gap: var(--space-2); }
.sub-toggle { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.interval-select { max-width: 180px; }
.role-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 7px; vertical-align: middle; }

.review { margin: 0; border: 1px solid var(--border); border-radius: var(--radius-surface); padding: var(--space-1) var(--space-4); }
.review-row {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-1) var(--space-4);
  padding: var(--space-2) 0; border-bottom: 1px solid var(--border);
}
.review-row:last-child { border-bottom: none; }
.review dt { color: var(--text-dim); font-size: var(--text-sm); }
.review dd { margin: 0; min-width: 0; overflow-wrap: anywhere; text-align: right; }
.review .id { color: var(--text-dim); font-size: var(--text-xs); }

.footer { display: flex; flex-wrap: wrap; align-items: center; width: 100%; gap: var(--space-2); }
.spacer { flex: 1; }

@media (max-width: 760px) {
  .feature-inputs { padding-left: 0; }
  .interval-select { max-width: none; }
  .step-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
@media (pointer: coarse), (max-width: 760px) {
  .tap, .w-full { min-height: var(--touch-min); }
}
</style>

<style>
/* The dialog header is rendered by PrimeVue outside this component's scope. */
@media (pointer: coarse), (max-width: 760px) {
  .setup-wizard .p-dialog-close-button { width: var(--touch-min); height: var(--touch-min); }
}
</style>
