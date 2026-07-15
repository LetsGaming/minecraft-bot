<template>
  <div>
    <ViewHeader title="Audit Log" subtitle="Admin actions taken through the dashboard and the bot.">
      <template v-if="entries.length" #actions>
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText v-model="filter" placeholder="Filter…" size="small" />
        </IconField>
      </template>
    </ViewHeader>

    <!-- Config rollback: snapshots of the config before each change -->
    <section v-if="history.length" class="history-section">
      <div class="history-head">
        <h3>Config history</h3>
        <span class="muted small">
          Snapshots from the last {{ retentionDays }} days · restoring one is reversible
        </span>
      </div>
      <DataTable :value="history" size="small" stripedRows class="audit-table">
        <Column field="at" header="When" style="width: 190px">
          <template #body="{ data }"><span class="muted mono small">{{ data.at }}</span></template>
        </Column>
        <Column field="note" header="Change">
          <template #body="{ data }">{{ data.note ?? "config change" }}</template>
        </Column>
        <Column field="by" header="By" style="width: 200px">
          <template #body="{ data }"><span class="small">{{ data.by ?? "—" }}</span></template>
        </Column>
        <Column header="" style="width: 130px">
          <template #body="{ data }">
            <Button
              label="Roll back"
              icon="pi pi-history"
              size="small"
              text
              severity="secondary"
              :loading="busyId === data.id"
              @click="confirmRollback(data)"
            />
          </template>
        </Column>
      </DataTable>
    </section>

    <h3 v-if="history.length && entries.length" class="actions-heading">Actions</h3>

    <DataTable
      v-if="entries.length"
      :value="filtered"
      paginator
      :rows="20"
      :rowsPerPageOptions="[20, 50, 100]"
      size="small"
      stripedRows
      class="audit-table"
    >
      <Column field="at" header="When" style="width: 190px">
        <template #body="{ data }"><span class="muted mono small">{{ data.at }}</span></template>
      </Column>
      <Column field="action" header="Action">
        <template #body="{ data }"><Tag :value="data.action" severity="secondary" /></template>
      </Column>
      <Column field="server" header="Server" style="width: 130px">
        <template #body="{ data }">{{ data.server ?? "—" }}</template>
      </Column>
      <Column field="by" header="By" style="width: 200px">
        <template #body="{ data }"><span class="small">{{ data.by }}</span></template>
      </Column>
      <Column field="detail" header="Detail">
        <template #body="{ data }"><span class="muted small">{{ data.detail ?? "" }}</span></template>
      </Column>
    </DataTable>

    <EmptyState v-else icon="pi pi-history">
      No audit entries yet.
    </EmptyState>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Tag from "primevue/tag";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import Button from "primevue/button";
import type { AuditEntry } from "../api";
import { useAudit } from "../composables/useAudit";
import { useConfigHistory } from "../composables/useConfigHistory";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";

export default defineComponent({
  name: "AuditView",
  components: { DataTable, Column, Tag, InputText, IconField, InputIcon, Button, ViewHeader, EmptyState },
  setup() {
    const { entries, load } = useAudit();
    const {
      entries: history,
      retentionDays,
      busyId,
      load: loadHistory,
      confirmRollback,
    } = useConfigHistory();
    return { entries, load, history, retentionDays, busyId, loadHistory, confirmRollback };
  },
  data() {
    return { filter: "" };
  },
  computed: {
    filtered(): AuditEntry[] {
      const q = this.filter.trim().toLowerCase();
      if (!q) return this.entries;
      return this.entries.filter((e) =>
        [e.action, e.server, e.by, e.detail]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    },
  },
  async mounted() {
    await Promise.all([this.load(), this.loadHistory()]);
  },
});
</script>

<style scoped>
.history-section {
  margin-bottom: 1.75rem;
}
.history-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin: 0 0 0.5rem;
  flex-wrap: wrap;
}
.history-head h3 {
  margin: 0;
  font-size: 1.05rem;
}
.actions-heading {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}
</style>
