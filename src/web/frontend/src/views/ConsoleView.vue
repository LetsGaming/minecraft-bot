<template>
  <div class="view-fill console-view">
    <ViewHeader :title="t('console.title')" :subtitle="t('console.lede')">
      <template v-if="current" #actions>
        <StatusChip :state="connectionRole" :label="connectionLabel" :busy="connecting" live />
      </template>
    </ViewHeader>

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server" :title="t('console.noServersTitle')">
      {{ t("console.noServers") }}
    </EmptyState>

    <template v-else>
      <InlineError
        v-if="closedReason"
        class="closed"
        :title="closedTitle"
        :recovery="closedRecovery"
        :detail="statusDetail"
        :retry-label="t('console.reconnect')"
        :heading-level="2"
        @retry="reconnect"
      />

      <!-- Filters sit above the pane so the pane itself can own all the
           remaining height. -->
      <div class="pane-tools">
        <span :id="levelLabelId" class="sr-only">{{ t("console.levelLabel") }}</span>
        <SelectButton
          v-model="minLevel"
          class="levels"
          :options="levelOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          size="small"
          :aria-labelledby="levelLabelId"
        />
        <label for="console-filter" class="sr-only">{{ t("console.filterLabel") }}</label>
        <IconField class="pane-search">
          <InputIcon class="pi pi-search" />
          <InputText id="console-filter" v-model="query" :placeholder="t('console.filterPlaceholder')" size="small" />
        </IconField>
        <label class="toggle">
          <input v-model="wrap" type="checkbox" />
          {{ t("console.wrap") }}
        </label>
      </div>

      <div
        ref="pane"
        :class="['pane', 'mono', { nowrap: !wrap }]"
        role="log"
        tabindex="0"
        :aria-label="t('console.logLabel', { server: current })"
        @scroll="onScroll"
      >
        <p v-if="lines.length === 0" class="pane-empty">{{ t("console.waiting") }}</p>
        <p v-else-if="visibleLines.length === 0" class="pane-empty">{{ t("console.noMatch") }}</p>
        <div
          v-for="line in visibleLines"
          :key="line.id"
          :class="['line', logLevel(line.text)]"
        >{{ line.text }}</div>
      </div>

      <div class="pane-foot">
        <label class="toggle">
          <input v-model="autoScroll" type="checkbox" />
          {{ t("console.follow") }}
        </label>
        <span class="foot-count">{{ countText }}</span>
      </div>

      <!-- Command input, only for those who may send. -->
      <form v-if="canSendCommands" class="composer" @submit.prevent="submit">
        <label for="console-command" class="sr-only">{{ t("console.commandLabel", { server: current }) }}</label>
        <InputText
          id="console-command"
          v-model="command"
          :maxlength="maxLength"
          :placeholder="t('console.commandPlaceholder')"
          :invalid="commandBlocked"
          aria-describedby="console-command-hint"
          autocomplete="off"
          class="composer-input"
          @keydown.up.prevent="recall('previous')"
          @keydown.down.prevent="recall('next')"
        />
        <Button
          type="submit"
          class="tap"
          :label="t('console.send')"
          icon="pi pi-send"
          size="small"
          :loading="sending"
          :disabled="!canSend"
        />
      </form>
      <p v-if="canSendCommands" id="console-command-hint" :class="['hint', { blocked: commandBlocked }]">
        <template v-if="commandBlocked">{{ t("console.blocked", { command: commandWord }) }}</template>
        <template v-else>{{ blockedHint }}</template>
      </p>
      <InlineError
        v-if="error"
        class="send-error"
        :title="t('console.sendFailedTitle')"
        :recovery="t('console.sendFailedText')"
        :detail="error"
        :retry-label="t('console.sendAgain')"
        :busy="sending"
        @retry="submit"
      />
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, useId } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import SelectButton from "primevue/selectbutton";
import { StatusRole } from "@mcbot/schema";
import { logLevel, lineMatches, type LogLevel } from "../utils/logLine";
import { CommandHistory } from "../utils/commandHistory";
import { useConsole, type ConsoleLine } from "../composables/useConsole";
import { useCapabilities } from "../composables/useCapabilities";
import { t } from "../i18n";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineError from "../components/ui/InlineError.vue";

/** Distance from the bottom still counted as "at the bottom", in px. */
const STICK_THRESHOLD = 40;

export default defineComponent({
  name: "ConsoleView",
  components: {
    Button, InputText, IconField, InputIcon, SelectButton,
    ViewHeader, StatusChip, EmptyState, InlineError,
  },
  props: {
    /** Server ids the caller may read, from the shell's status poll. */
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  setup() {
    return {
      ...useConsole(),
      ...useCapabilities(),
      logLevel,
      t,
      levelLabelId: `console-levels-${useId()}`,
      history: new CommandHistory(),
    };
  },
  data() {
    return {
      current: "",
      programmaticScroll: false,
      query: "",
      wrap: true,
      minLevel: "info" as LogLevel,
      levelOptions: [
        { value: "info", label: t("console.levelAll") },
        { value: "warn", label: t("console.levelWarn") },
        { value: "error", label: t("console.levelError") },
      ],
    };
  },
  computed: {
    canSendCommands(): boolean {
      return this.can("server:console", this.current);
    },
    /** Monotonic id of the newest buffered line; 0 when the buffer is empty. */
    lastLineId(): number {
      return this.lines[this.lines.length - 1]?.id ?? 0;
    },
    /**
     * Filtering is client-side over the buffer the stream already delivered,
     * so switching level never re-requests and never loses backlog.
     */
    visibleLines(): ConsoleLine[] {
      if (this.minLevel === "info" && this.query.trim() === "") return this.lines;
      return this.lines.filter((l) =>
        lineMatches(l.text, { minLevel: this.minLevel, query: this.query }),
      );
    },
    countText(): string {
      return this.visibleLines.length === this.lines.length
        ? t("console.buffered", { count: this.lines.length })
        : t("console.bufferedFiltered", { shown: this.visibleLines.length, count: this.lines.length });
    },
    connectionRole(): StatusRole {
      if (this.connecting) return StatusRole.Info;
      if (this.connected) return StatusRole.Online;
      return this.closedReason ? StatusRole.Offline : StatusRole.Degraded;
    },
    connectionLabel(): string {
      if (this.connecting) return t("console.connecting");
      if (this.connected) return t("console.live");
      if (this.closedReason) return t("console.closed");
      return this.statusDetail || t("console.disconnected");
    },
    closedTitle(): string {
      return this.closedReason === "removed" ? t("console.removedTitle") : t("console.revokedTitle");
    },
    closedRecovery(): string {
      return this.closedReason === "removed" ? t("console.removedText") : t("console.revokedText");
    },
    commandWord(): string {
      return this.command.trim().replace(/^\//, "").split(/\s+/)[0] ?? "";
    },
    blockedHint(): string {
      return this.blockedCommands.length
        ? t("console.blockedList", { list: this.blockedCommands.join(", ") })
        : t("console.blockedNone");
    },
  },
  watch: {
    // Re-open when the shell switches server, and pick a default once the
    // first status poll tells us what exists.
    activeServer(id: string) {
      if (id && id !== this.current) void this.select(id);
    },
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (!this.current && ids.length > 0) {
          void this.select(this.activeServer && ids.includes(this.activeServer)
            ? this.activeServer
            : ids[0]!);
        }
      },
    },
    /**
     * Watch the newest line's id, not the array.
     *
     * `visibleLines` returns `this.lines` itself when no filter is active, so
     * pushing a line mutates it in place and the computed's value is
     * reference-identical; a shallow watcher never fires. The id also climbs
     * past the ring buffer cap, where the length stops changing.
     */
    lastLineId() {
      if (this.autoScroll) void this.$nextTick(() => this.scrollToBottom());
    },
  },
  methods: {
    async select(id: string): Promise<void> {
      this.current = id;
      // Following is the intent of opening a console; a leftover disengage
      // from the previous server must not carry over to this one.
      this.autoScroll = true;
      await this.open(id);
      // `open()` only starts the stream; the backlog arrives over the next
      // ticks and the lastLineId watcher scrolls for it. This handles an
      // already-warm buffer.
      void this.$nextTick(() => this.scrollToBottom());
    },
    reconnect(): void {
      if (this.current) void this.select(this.current);
    },
    async submit(): Promise<void> {
      const text = this.command;
      if (await this.send()) this.history.record(text);
    },
    recall(direction: "previous" | "next"): void {
      const value = direction === "previous" ? this.history.previous(this.command) : this.history.next();
      if (value !== null) this.command = value;
    },
    scrollToBottom(): void {
      const pane = this.$refs.pane as HTMLElement | undefined;
      if (!pane) return;
      this.programmaticScroll = true;
      pane.scrollTop = pane.scrollHeight;
      // Assigning scrollTop fires a scroll event asynchronously. Measured
      // against layout that has not settled, `onScroll` read a large distance
      // from the bottom and switched following off on the first backlog
      // flush. Hold the guard until after that event has been delivered.
      requestAnimationFrame(() => {
        this.programmaticScroll = false;
      });
    },
    /**
     * Sticky follow: scrolling up disengages, returning to the bottom
     * re-engages. Never fight the reader for the scrollbar.
     */
    onScroll(): void {
      // Our own scroll, not the reader's. Only a human disengages follow.
      if (this.programmaticScroll) return;
      const pane = this.$refs.pane as HTMLElement | undefined;
      if (!pane) return;
      const distance = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      this.autoScroll = distance <= STICK_THRESHOLD;
    },
  },
});
</script>

<style scoped>
/* The view is a column that fills the shell's content area, so the pane
   grows into whatever height is left instead of a fixed share. */
.console-view { display: flex; flex-direction: column; min-width: 0; }
.closed { margin-bottom: var(--space-3); }

.pane-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-2); }
.pane-search { flex: 1 1 200px; min-width: 0; }
.pane-search :deep(input) { width: 100%; }

.pane {
  flex: 1;
  min-height: 220px;
  /* Fills the window but stops growing on a tall display, so the composer
     stays above the fold. */
  max-height: 68vh;
  overflow: auto;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
}
.pane-empty { margin: 0; padding: var(--space-1) 0; color: var(--text-dim); font-family: var(--font-ui); font-size: var(--text-sm); }
/* Three weights, so the line that matters is the one that stands out. */
.line { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-muted); }
.nowrap .line { white-space: pre; overflow-wrap: normal; width: max-content; min-width: 100%; }
.line.warn { color: var(--st-degraded); }
.line.error { color: var(--danger); }

.pane-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 2px 0;
}
.foot-count { color: var(--text-dim); font-size: var(--text-sm); }
.toggle { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-dim); font-size: var(--text-sm); cursor: pointer; }
.toggle input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }

.composer { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
.composer-input { flex: 1; min-width: 0; font-family: var(--font-mono); }
.hint { margin: var(--space-2) 2px 0; color: var(--text-dim); font-size: var(--text-sm); }
.hint.blocked { color: var(--danger); }
.send-error { margin-top: var(--space-3); }

@media (pointer: coarse), (max-width: 760px) {
  .tap, .composer-input { min-height: var(--touch-min); }
  .pane-search :deep(input) { min-height: var(--touch-min); }
  .levels :deep(.p-togglebutton) { min-height: var(--touch-min); }
  .toggle { min-height: var(--touch-min); }
}
</style>
