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
import type { AuditEntry } from "../api";
import { useAudit } from "../composables/useAudit";
import ViewHeader from "../components/ViewHeader.vue";
import EmptyState from "../components/EmptyState.vue";

export default defineComponent({
  name: "AuditView",
  components: { DataTable, Column, Tag, InputText, IconField, InputIcon, ViewHeader, EmptyState },
  setup() {
    const { entries, load } = useAudit();
    return { entries, load };
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
    await this.load();
  },
});
</script>
