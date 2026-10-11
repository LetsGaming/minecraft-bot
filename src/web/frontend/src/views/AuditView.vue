<template>
  <div class="audit-view">
    <ViewHeader :title="t('audit.title')" :subtitle="t('audit.lede')">
      <template #actions>
        <Button
          class="tap"
          icon="pi pi-refresh"
          :label="t('audit.refresh')"
          severity="secondary"
          outlined
          size="small"
          :loading="loading || historyLoading"
          @click="reload"
        />
      </template>
    </ViewHeader>

    <div class="stack-gap">
      <!-- Config history is sysadmin only, so a refusal here means "not for
           you" and the section stays away instead of reporting an error. -->
      <section
        v-if="showHistory"
        class="card"
        aria-labelledby="audit-history-h"
        :aria-busy="historyLoading ? 'true' : undefined"
      >
        <div class="card-head">
          <h2 id="audit-history-h">{{ t("audit.history.title") }}</h2>
          <span class="card-meta">{{ t("audit.history.meta", { days: retentionDays }) }}</span>
        </div>
        <InlineError
          v-if="historyFailure"
          :title="historyFailureCopy.title"
          :recovery="historyFailureCopy.recovery"
          :detail="historyFailureCopy.detail"
          :retryable="historyFailureCopy.retryable"
          :retry-label="historyFailureCopy.retryLabel"
          :busy="historyLoading"
          @retry="retryHistory"
        />
        <p v-else-if="history.length === 0" class="note">
          {{ t("audit.history.empty", { days: retentionDays }) }}
        </p>
        <DataTable v-else :value="history" size="small" stripedRows class="audit-table stack-table">
          <Column field="at" :header="t('audit.col.when')" :pt="{ bodyCell: { 'data-label': t('audit.col.when') } }" class="col-when">
            <template #body="{ data }">
              <span class="when" :title="timestampTitle(data.at)">{{ relativeAge(data.at) }}</span>
            </template>
          </Column>
          <Column field="note" :header="t('audit.col.change')" :pt="{ bodyCell: { 'data-label': t('audit.col.change') } }">
            <template #body="{ data }">{{ changeName(data) }}</template>
          </Column>
          <Column field="by" :header="t('audit.col.by')" :pt="{ bodyCell: { 'data-label': t('audit.col.by') } }" class="col-by">
            <template #body="{ data }">{{ data.by ?? t("audit.unknownActor") }}</template>
          </Column>
          <Column :header="t('audit.col.actions')" :pt="{ bodyCell: { 'data-label': t('audit.col.actions') } }" class="col-actions">
            <template #body="{ data }">
              <Button
                class="tap"
                :label="t('audit.rollback.button')"
                icon="pi pi-history"
                size="small"
                text
                severity="secondary"
                :aria-label="t('audit.rollback.buttonFor', { change: changeName(data), when: relativeAge(data.at) })"
                :loading="busyId === data.id"
                :disabled="busyId !== null"
                @click="confirmRollback(data)"
              />
            </template>
          </Column>
        </DataTable>
      </section>

      <section class="card" aria-labelledby="audit-actions-h" :aria-busy="loading ? 'true' : undefined">
        <div class="card-head">
          <h2 id="audit-actions-h">{{ t("audit.actions.title") }}</h2>
          <span v-if="entries.length" class="card-meta">{{ countText }}</span>
          <span v-if="entries.length" class="filter">
            <label for="audit-filter" class="sr-only">{{ t("audit.filterLabel") }}</label>
            <IconField>
              <InputIcon class="pi pi-search" />
              <InputText
                id="audit-filter"
                v-model="filter"
                class="filter-input"
                :placeholder="t('audit.filterPlaceholder')"
                size="small"
              />
            </IconField>
          </span>
        </div>

        <p v-if="!loaded" class="note" role="status">{{ t("audit.loading") }}</p>
        <InlineError
          v-else-if="failure"
          :title="failureCopyFor.title"
          :recovery="failureCopyFor.recovery"
          :detail="failureCopyFor.detail"
          :retryable="failureCopyFor.retryable"
          :retry-label="failureCopyFor.retryLabel"
          :busy="loading"
          @retry="retryEntries"
        />
        <EmptyState v-else-if="entries.length === 0" icon="pi pi-history" :title="t('audit.emptyTitle')">
          {{ t("audit.emptyText") }}
        </EmptyState>
        <EmptyState v-else-if="filtered.length === 0" icon="pi pi-filter-slash" :title="t('audit.noMatchTitle', { query: filter.trim() })">
          {{ t("audit.noMatchText") }}
          <template #action>
            <Button class="tap" :label="t('audit.clearFilter')" size="small" outlined @click="filter = ''" />
          </template>
        </EmptyState>
        <template v-else>
          <SortControl v-model:field="sort.field" v-model:order="sort.order" :options="sortOptions" />
          <DataTable
            v-model:sortField="sort.field"
            v-model:sortOrder="sort.order"
            :value="filtered"
            :pt="{ pcPaginator: { paginatorContainer: { 'aria-label': t('audit.pages') } } }"
            paginator
            :rows="20"
            :rowsPerPageOptions="[20, 50, 100]"
            size="small"
            stripedRows
            class="audit-table stack-table"
          >
            <Column field="at" :header="t('audit.col.when')" :pt="{ bodyCell: { 'data-label': t('audit.col.when') } }" class="col-when" sortable>
              <template #body="{ data }">
                <span class="when" :title="timestampTitle(data.at)">{{ relativeAge(data.at) }}</span>
              </template>
            </Column>
            <Column field="action" :header="t('audit.col.action')" :pt="{ bodyCell: { 'data-label': t('audit.col.action') } }" sortable>
              <template #body="{ data }"><span class="action-tag">{{ data.action }}</span></template>
            </Column>
            <Column field="server" :header="t('audit.col.server')" :pt="{ bodyCell: { 'data-label': t('audit.col.server') } }" class="col-server">
              <template #body="{ data }">
                <span v-if="data.server" class="mono">{{ data.server }}</span>
                <span v-else class="dim">{{ t("audit.allServers") }}</span>
              </template>
            </Column>
            <Column field="by" :header="t('audit.col.by')" :pt="{ bodyCell: { 'data-label': t('audit.col.by') } }" class="col-by">
              <template #body="{ data }">{{ data.by }}</template>
            </Column>
            <Column field="detail" :header="t('audit.col.detail')" :pt="{ bodyCell: { 'data-label': t('audit.col.detail') } }">
              <template #body="{ data }">
                <span class="dim">{{ humanise(data.detail ?? "") }}</span>
              </template>
            </Column>
          </DataTable>
        </template>
      </section>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import Button from "primevue/button";
import type { AuditEntry } from "../api";
import { useAudit } from "../composables/useAudit";
import { useConfigHistory } from "../composables/useConfigHistory";
import { relativeAge, timestampTitle } from "../utils/time";
import { humaniseIds } from "../utils/humaniseIds";
import { failureCopy, signIn, type FailureCopy } from "../utils/loadFailure";
import { useGuilds } from "../composables/useGuilds";
import { t } from "../i18n";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineError from "../components/ui/InlineError.vue";
import SortControl from "../components/ui/SortControl.vue";

export default defineComponent({
  name: "AuditView",
  components: {
    DataTable, Column, InputText, IconField, InputIcon, Button, ViewHeader, EmptyState, InlineError, SortControl,
  },
  setup() {
    const audit = useAudit();
    const { knownGuildName, load: loadGuildNames } = useGuilds();
    const history = useConfigHistory(knownGuildName);
    return {
      entries: audit.entries,
      loading: audit.loading,
      loaded: audit.loaded,
      failure: audit.failure,
      auditError: audit.error,
      load: audit.load,
      history: history.entries,
      retentionDays: history.retentionDays,
      historyLoading: history.loading,
      historyLoaded: history.loaded,
      historyFailure: history.failure,
      historyError: history.error,
      busyId: history.busyId,
      loadHistory: history.load,
      confirmRollback: history.confirmRollback,
      changeName: history.changeName,
      relativeAge,
      timestampTitle,
      knownGuildName,
      loadGuildNames,
      t,
    };
  },
  data() {
    return { filter: "", sort: { field: "at", order: -1 as 1 | -1 } };
  },
  computed: {
    sortOptions(): Array<{ field: string; label: string }> {
      return [
        { field: "at", label: t("audit.col.when") },
        { field: "action", label: t("audit.col.action") },
      ];
    },
    filtered(): AuditEntry[] {
      const q = this.filter.trim().toLowerCase();
      if (!q) return this.entries;
      return this.entries.filter((e) =>
        [e.action, e.server, e.by, e.detail]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    },
    countText(): string {
      return this.filter.trim()
        ? t("audit.countFiltered", { shown: this.filtered.length, total: this.entries.length })
        : t("audit.count", { count: this.entries.length });
    },
    showHistory(): boolean {
      return this.historyLoaded && this.historyFailure !== "forbidden";
    },
    failureCopyFor(): FailureCopy {
      return failureCopy(this.failure ?? "failed", {
        failedTitle: t("audit.failedTitle"),
        failedText: t("audit.failedText"),
        forbiddenTitle: t("audit.forbiddenTitle"),
        capability: "audit:read",
        request: "GET /api/audit",
        error: this.auditError,
      });
    },
    historyFailureCopy(): FailureCopy {
      return failureCopy(this.historyFailure ?? "failed", {
        failedTitle: t("audit.history.failedTitle"),
        failedText: t("audit.history.failedText"),
        forbiddenTitle: "",
        capability: "bot:config",
        request: "GET /api/config/history",
        error: this.historyError,
      });
    },
  },
  methods: {
    /** Guild IDs inside server-composed text, shown as names where known. */
    humanise(text: string): string {
      return humaniseIds(text, this.knownGuildName);
    },
    async reload(): Promise<void> {
      await Promise.all([this.load(), this.loadHistory()]);
    },
    retryEntries(): void {
      if (this.failure === "signedOut") signIn();
      else void this.load();
    },
    retryHistory(): void {
      if (this.historyFailure === "signedOut") signIn();
      else void this.loadHistory();
    },
  },
  async mounted() {
    await Promise.all([this.load(), this.loadHistory(), this.loadGuildNames()]);
  },
});
</script>

<style scoped>
.audit-view { min-width: 0; }
.stack-gap { display: flex; flex-direction: column; gap: var(--space-4); }
.card {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
}
.card-head h2 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.card-meta { flex: 1 1 auto; color: var(--text-dim); font-size: var(--text-sm); }
.filter { flex: 0 1 280px; min-width: min(220px, 100%); }
.filter :deep(.p-iconfield) { width: 100%; }
.filter-input { width: 100%; }
.note { margin: 0; color: var(--text-dim); font-size: var(--text-sm); }
.dim { color: var(--text-dim); }
.when { color: var(--text-dim); font-family: var(--font-mono); font-size: var(--text-xs); white-space: nowrap; }
.action-tag {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  font-size: var(--text-xs);
}
.audit-table :deep(.col-when) { width: 150px; }
.audit-table :deep(.col-by) { width: 180px; }
.audit-table :deep(.col-server) { width: 130px; }
.audit-table :deep(.col-actions) { width: 140px; }

@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
  .filter-input { min-height: var(--touch-min); }
  .audit-table :deep(.p-paginator button),
  .audit-table :deep(.p-paginator .p-select) { min-width: var(--touch-min); min-height: var(--touch-min); }
}
</style>
