<template>
  <Dialog
    :visible="visible"
    modal
    :closable="!writing"
    :style="{ width: '620px', maxWidth: '94vw' }"
    header="Guided guild setup"
    @update:visible="$emit('update:visible', $event)"
  >
    <!-- Step indicator -->
    <div class="steps">
      <div
        v-for="(label, i) in stepLabels"
        :key="i"
        :class="['step', { active: step === i, done: step > i }]"
      >
        <span class="step-num">
          <i v-if="step > i" class="pi pi-check" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="step-label">{{ label }}</span>
      </div>
    </div>

    <!-- ── Step 0: guild + default server ── -->
    <section v-if="step === 0" class="panel">
      <div v-if="loadingGuilds" class="center muted">
        <ProgressSpinner style="width: 34px; height: 34px" strokeWidth="4" />
        <p class="small">Reading guilds from Discord…</p>
      </div>
      <div v-else-if="guildError" class="load-error">
        <Message severity="error" :closable="false">{{ guildError }}</Message>
        <Button label="Retry" icon="pi pi-refresh" size="small" text @click="loadGuilds" />
      </div>
      <template v-else>
        <label class="field-label">Which server should the bot be set up for?</label>
        <Select
          v-model="guildId"
          :options="guildOptions"
          optionLabel="label"
          optionValue="id"
          placeholder="Select a Discord server"
          filter
          class="w-full"
          @change="onGuildPicked"
        >
          <template #option="{ option }">
            <div class="guild-opt">
              <span>{{ option.name }}</span>
              <Tag
                v-if="option.configured"
                value="configured"
                severity="secondary"
              />
            </div>
          </template>
        </Select>
        <p v-if="alreadyConfigured" class="hint warn-hint">
          <i class="pi pi-info-circle" /> This guild already has config — the
          wizard is pre-filled with its current settings and will update it.
        </p>

        <template v-if="sysadmin">
          <label class="field-label mt">Default Minecraft server for this guild</label>
          <Select
            v-model="defaultServer"
            :options="serverOptions"
            optionLabel="label"
            optionValue="id"
            :placeholder="serverOptions.length ? 'Select a server' : 'No servers configured'"
            :disabled="serverOptions.length === 0"
            showClear
            class="w-full"
          />
          <p class="hint">
            Features below post to this server unless you configure otherwise
            later. With one server configured this is optional.
          </p>
        </template>
      </template>
    </section>

    <!-- ── Step 1: features ── -->
    <section v-else-if="step === 1" class="panel">
      <div v-if="loadingChannels" class="center muted">
        <ProgressSpinner style="width: 34px; height: 34px" strokeWidth="4" />
        <p class="small">Reading channels and roles…</p>
      </div>
      <div v-else-if="channelError" class="load-error">
        <Message severity="error" :closable="false">{{ channelError }}</Message>
        <Button label="Retry" icon="pi pi-refresh" size="small" text @click="loadChannelsRoles" />
      </div>
      <template v-else>
        <p class="hint top-hint">
          Toggle the features this guild should use and pick their channels.
          You can change any of this later in Config.
        </p>
        <div class="feature-list">
          <div
            v-for="f in features"
            :key="f.key"
            :class="['feature-row', { on: model[f.key].enabled }]"
          >
            <div class="feature-head">
              <ToggleSwitch v-model="model[f.key].enabled" />
              <div class="feature-meta">
                <span class="feature-name"><i :class="f.icon" /> {{ f.label }}</span>
                <span class="feature-hint muted small">{{ f.hint }}</span>
              </div>
            </div>

            <div v-if="model[f.key].enabled" class="feature-inputs">
              <Select
                v-if="f.input !== 'enabled' && f.input !== 'role'"
                v-model="model[f.key].channelId"
                :options="channels"
                optionLabel="name"
                optionValue="id"
                filter
                :placeholder="f.input === 'channel+admin' ? 'Application channel' : 'Select a channel'"
                class="w-full"
              >
                <template #value="{ value }">
                  <span v-if="value">#{{ channelName(value) }}</span>
                  <span v-else class="muted">{{ f.input === 'channel+admin' ? 'Application channel' : 'Select a channel' }}</span>
                </template>
                <template #option="{ option }">#{{ option.name }}</template>
              </Select>

              <Select
                v-if="f.input === 'channel+admin'"
                v-model="model[f.key].adminChannelId"
                :options="channels"
                optionLabel="name"
                optionValue="id"
                filter
                placeholder="Staff review channel"
                class="w-full"
              >
                <template #value="{ value }">
                  <span v-if="value">#{{ channelName(value) }}</span>
                  <span v-else class="muted">Staff review channel</span>
                </template>
                <template #option="{ option }">#{{ option.name }}</template>
              </Select>

              <Select
                v-else-if="f.input === 'role'"
                v-model="model[f.key].roleId"
                :options="roles"
                optionLabel="name"
                optionValue="id"
                filter
                placeholder="Select a role"
                class="w-full"
              >
                <template #option="{ option }">
                  <span class="role-dot" :style="roleDot(option.color)" />{{ option.name }}
                </template>
              </Select>

              <div v-if="f.input === 'channel+webhook'" class="sub-toggle">
                <ToggleSwitch v-model="model[f.key].useWebhook" inputId="usewh" />
                <label for="usewh" class="small">Use a webhook (shows player names/skins)</label>
              </div>

              <Select
                v-if="f.input === 'channel+interval'"
                v-model="model[f.key].interval"
                :options="intervalOptions"
                optionLabel="label"
                optionValue="value"
                class="w-full interval-select"
              />
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- ── Step 2: review ── -->
    <section v-else class="panel">
      <p class="hint top-hint">Review what will be written for this guild.</p>
      <div class="review">
        <div class="review-row">
          <span class="muted small">Guild</span>
          <span>{{ guildName(guildId) }} <span class="muted mono small">{{ guildId }}</span></span>
        </div>
        <div class="review-row">
          <span class="muted small">Default server</span>
          <span>{{ defaultServer || "— (guild default)" }}</span>
        </div>
        <div class="review-row" v-for="f in enabledFeatures" :key="f.key">
          <span class="muted small">{{ f.label }}</span>
          <span>{{ reviewValue(f) }}</span>
        </div>
        <div v-if="enabledFeatures.length === 0" class="muted small no-feat">
          No features enabled — only the default server will be set.
        </div>
      </div>
      <Message v-if="writeError" severity="error" :closable="false" class="mt">
        {{ writeError }}
      </Message>
    </section>

    <template #footer>
      <div class="footer">
        <Button
          v-if="step > 0"
          label="Back"
          icon="pi pi-chevron-left"
          text
          :disabled="writing"
          @click="step--"
        />
        <span class="spacer" />
        <Button
          label="Cancel"
          severity="secondary"
          text
          :disabled="writing"
          @click="$emit('update:visible', false)"
        />
        <Button
          v-if="step < 2"
          label="Next"
          icon="pi pi-chevron-right"
          iconPos="right"
          :disabled="!canAdvance"
          @click="next"
        />
        <Button
          v-else
          label="Write config"
          icon="pi pi-check"
          :loading="writing"
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
import Message from "primevue/message";
import Tag from "primevue/tag";
import ProgressSpinner from "primevue/progressspinner";
import { useGuildSetup, FEATURES, type FeatureDesc } from "../composables/useGuildSetup";

export default defineComponent({
  name: "SetupWizard",
  components: { Dialog, Select, ToggleSwitch, Button, Message, Tag, ProgressSpinner },
  props: {
    visible: { type: Boolean, default: false },
    initialGuildId: { type: String, default: "" },
    sysadmin: { type: Boolean, default: false },
  },
  emits: ["update:visible", "written"],
  setup(props) {
    return { ...useGuildSetup(() => props.sysadmin, () => props.initialGuildId) };
  },
  data() {
    return {
      step: 0,
      stepLabels: ["Server", "Features", "Review"],
      features: FEATURES,
      intervalOptions: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
        { value: "monthly", label: "Monthly" },
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
    canAdvance(): boolean {
      if (this.step === 0) return !!this.guildId;
      if (this.step === 1) {
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
        await this.loadChannelsRoles();
        if (!this.channelError) this.step = 1;
        return;
      }
      if (this.step === 1) {
        this.step = 2;
      }
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
    roleDot(color: number) {
      const hex = color ? `#${color.toString(16).padStart(6, "0")}` : "var(--mc-muted)";
      return { background: hex };
    },
    reviewValue(f: FeatureDesc): string {
      const m = this.model[f.key];
      if (f.input === "enabled") return "on";
      if (f.input === "role") {
        return this.roles.find((r) => r.id === m.roleId)?.name ?? m.roleId ?? "—";
      }
      const ch = `#${this.channelName(m.channelId ?? "")}`;
      if (f.input === "channel+webhook") return `${ch}${m.useWebhook ? " · webhook" : ""}`;
      if (f.input === "channel+interval") return `${ch} · ${m.interval}`;
      if (f.input === "channel+admin") return `${ch} · review #${this.channelName(m.adminChannelId ?? "")}`;
      return ch;
    },
  },
});
</script>

<style scoped>
.steps { display: flex; gap: 6px; margin-bottom: 18px; }
.step { display: flex; align-items: center; gap: 7px; flex: 1; color: var(--mc-muted); font-size: 12.5px; }
.step-num {
  width: 22px; height: 22px; border-radius: 50%; flex: none;
  display: grid; place-items: center; font-size: 12px;
  background: var(--mc-card); color: var(--mc-muted);
  border: 0.5px solid var(--mc-border-strong);
}
.step.active .step-num { background: var(--mc-accent); color: var(--mc-on-accent); border-color: var(--mc-accent); }
.step.active { color: var(--mc-text); }
.step.done .step-num { background: rgba(52,197,106,.15); color: var(--mc-accent); border-color: var(--mc-accent-border); }

.panel { min-height: 260px; }
.center { display: grid; place-items: center; gap: 10px; padding: 70px 0; text-align: center; }
.load-error { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

.field-label { display: block; font-size: 13.5px; font-weight: 500; margin-bottom: 6px; }
.field-label.mt { margin-top: 20px; }
.w-full { width: 100%; }
.hint { color: var(--mc-muted); font-size: 12.5px; line-height: 1.45; margin: 7px 0 0; }
.warn-hint { color: var(--mc-warn); }
.top-hint { margin: 0 0 14px; }

.guild-opt { display: flex; align-items: center; gap: 8px; justify-content: space-between; width: 100%; }

.feature-list { display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; padding-right: 4px; }
.feature-row { border: 0.5px solid var(--mc-border); border-radius: 9px; padding: 11px 13px; transition: border-color .15s; }
.feature-row.on { border-color: var(--mc-accent-border); }
.feature-head { display: flex; align-items: flex-start; gap: 11px; }
.feature-meta { display: flex; flex-direction: column; gap: 1px; }
.feature-name { font-size: 13.5px; font-weight: 500; display: flex; align-items: center; gap: 7px; }
.feature-name i { color: var(--mc-accent); font-size: 13px; }
.feature-hint { line-height: 1.4; }
.feature-inputs { margin-top: 11px; padding-left: 45px; display: flex; flex-direction: column; gap: 8px; }
.sub-toggle { display: flex; align-items: center; gap: 8px; }
.interval-select { max-width: 180px; }
.role-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 7px; vertical-align: middle; }

.review { border: 0.5px solid var(--mc-border); border-radius: 9px; padding: 4px 14px; }
.review-row { display: flex; justify-content: space-between; gap: 16px; padding: 9px 0; border-bottom: 0.5px solid var(--mc-border); }
.review-row:last-child { border-bottom: none; }
.no-feat { padding: 12px 0; }
.mt { margin-top: 14px; }

.footer { display: flex; align-items: center; width: 100%; gap: 6px; }
.spacer { flex: 1; }
</style>
