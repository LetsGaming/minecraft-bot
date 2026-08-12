<template>
  <div class="view-fill console-view">
    <ViewHeader title="Console" subtitle="Live server log, and a command line into it.">
      <template #actions>
        <span :class="['conn', connected ? 'up' : 'down']">
          <StatusDot :state="connected ? 'up' : 'down'" />
          {{ connected ? "Live" : statusDetail || "Disconnected" }}
        </span>
      </template>
    </ViewHeader>

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server">
      No servers you can view.
    </EmptyState>

    <template v-else>
      <!-- Server picker, only when there is a choice to make. -->
      <div v-if="serverIds.length > 1" class="picker">
        <Button
          v-for="id in serverIds"
          :key="id"
          :label="id"
          size="small"
          :severity="id === current ? 'primary' : 'secondary'"
          :outlined="id !== current"
          @click="select(id)"
        />
      </div>

      <!-- Filters sit above the pane so the pane itself can own all the
           remaining height. -->
      <div class="pane-tools">
        <SelectButton
          v-model="minLevel"
          :options="levelOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          size="small"
        />
        <IconField class="pane-search">
          <InputIcon class="pi pi-search" />
          <InputText v-model="query" placeholder="Filter lines…" size="small" />
        </IconField>
      </div>

      <div ref="pane" class="pane mono" @scroll="onScroll">
        <div v-if="lines.length === 0" class="muted small pane-empty">
          Waiting for output…
        </div>
        <div v-else-if="visibleLines.length === 0" class="muted small pane-empty">
          No buffered line matches those filters.
        </div>
        <div
          v-for="line in visibleLines"
          :key="line.id"
          :class="['line', logLevel(line.text)]"
        >{{ line.text }}</div>
      </div>

      <div class="pane-foot">
        <label class="follow small muted">
          <input type="checkbox" v-model="autoScroll" />
          Follow output
        </label>
        <span class="muted small">
          <template v-if="visibleLines.length !== lines.length">
            {{ visibleLines.length }} of
          </template>
          {{ lines.length }} lines buffered
        </span>
      </div>

      <!-- Command input, only for those who may send. -->
      <div v-if="canSendCommands" class="composer">
        <InputText
          v-model="command"
          :maxlength="maxLength"
          placeholder="Type a command, e.g. list"
          :invalid="commandBlocked"
          class="composer-input"
          @keyup.enter="send"
        />
        <Button
          label="Send"
          icon="pi pi-send"
          size="small"
          :loading="sending"
          :disabled="!canSend"
          @click="send"
        />
      </div>
      <p v-if="commandBlocked" class="blocked small">
        That command is blocked on this dashboard.
      </p>
      <p v-else-if="canSendCommands" class="muted small hint">
        Blocked here: {{ blockedCommands.join(", ") || "nothing" }}. The leading slash is optional.
      </p>
      <Message v-if="error" severity="error" :closable="false" class="composer-error">
        {{ error }}
      </Message>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import { logLevel, lineMatches, type LogLevel } from "../utils/logLine";
import { useConsole, type ConsoleLine } from "../composables/useConsole";
import { useCapabilities } from "../composables/useCapabilities";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusDot from "../components/ui/StatusDot.vue";
import EmptyState from "../components/ui/EmptyState.vue";

/** Distance from the bottom still counted as "at the bottom", in px. */
const STICK_THRESHOLD = 40;

export default defineComponent({
  name: "ConsoleView",
  components: {
    Button, InputText, IconField, InputIcon, SelectButton, Message,
    ViewHeader, StatusDot, EmptyState,
  },
  props: {
    /** Server ids the caller may read, from the shell's status poll. */
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  setup() {
    return { ...useConsole(), ...useCapabilities(), logLevel };
  },
  data() {
    return {
      current: "",
      programmaticScroll: false,
      query: "",
      minLevel: "info" as LogLevel,
      levelOptions: [
        { value: "info", label: "All" },
        { value: "warn", label: "Warn+" },
        { value: "error", label: "Errors" },
      ],
    };
  },
  computed: {
    canSendCommands(): boolean {
      return this.can("server:console", this.current);
    },
    /**
     * Filtering is client-side over the buffer the stream already delivered,
     * so switching level never re-requests and never loses backlog: clearing
     * the filter brings every line straight back.
     */
    /** Monotonic id of the newest buffered line; 0 when the buffer is empty. */
    lastLineId(): number {
      return this.lines[this.lines.length - 1]?.id ?? 0;
    },
    visibleLines(): ConsoleLine[] {
      if (this.minLevel === "info" && this.query.trim() === "") return this.lines;
      return this.lines.filter((l) =>
        lineMatches(l.text, { minLevel: this.minLevel, query: this.query }),
      );
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
     * reference-identical. A default (shallow) watcher never fired, which is
     * why the pane sat wherever it was while output streamed past. Watching
     * the id also survives the ring buffer: at the 100-line cap the length
     * stops changing but the newest id still climbs.
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
      // `open()` only starts the stream — the backlog arrives over the next
      // few ticks, so there is nothing to scroll to yet. The lastLineId
      // watcher takes it from here; this just handles an already-warm buffer.
      void this.$nextTick(() => this.scrollToBottom());
    },
    scrollToBottom(): void {
      const pane = this.$refs.pane as HTMLElement | undefined;
      if (!pane) return;
      this.programmaticScroll = true;
      pane.scrollTop = pane.scrollHeight;
      // Assigning scrollTop fires a scroll event asynchronously. Measured
      // against layout that has not settled, `onScroll` read a large distance
      // from the bottom and switched following off — so the pane disengaged
      // itself on the very first backlog flush and stayed at the top. Hold
      // the guard until after that event has been delivered.
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
.conn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.conn.up { color: var(--mc-text); }
.conn.down { color: var(--mc-muted); }

.picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }

/* The view is a column that fills the shell's content area, so the pane
   grows into whatever height is left instead of taking a fixed 55vh and
   leaving the rest of a tall screen empty. */
.console-view { display: flex; flex-direction: column; }

.pane-tools { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
.pane-search { flex: 1; min-width: 200px; }
.pane-search :deep(input) { width: 100%; }

.pane {
  flex: 1;
  min-height: 220px;
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--mc-card);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  font-size: 12px;
  line-height: 1.55;
}
.pane-empty { padding: 4px 0; }
/* Three weights, so the line that matters is the one that stands out. */
.line { white-space: pre-wrap; word-break: break-word; color: var(--mc-muted); }
.line.info { color: var(--mc-muted); }
.line.warn { color: var(--mc-mid); }
.line.error { color: var(--mc-bad); }

.pane-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 2px 0;
}
.follow { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

.composer { display: flex; gap: 8px; margin-top: 10px; }
.composer-input { flex: 1; font-family: var(--mc-mono); }
.composer-error { margin-top: 8px; }
.blocked { color: var(--mc-danger); margin: 6px 2px 0; }
.hint { margin: 6px 2px 0; }
</style>
