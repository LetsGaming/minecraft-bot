<template>
  <div>
    <div class="view-head">
      <div>
        <h2>Audit Log</h2>
        <p class="muted small">Admin actions taken through the dashboard and the bot.</p>
      </div>
      <IconField v-if="entries.length">
        <InputIcon class="pi pi-search" />
        <InputText v-model="filter" placeholder="Filter…" size="small" />
      </IconField>
    </div>

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

    <div v-else class="empty">
      <i class="pi pi-history" />
      <p>No audit entries yet.</p>
    </div>
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
import { apiGet } from "../api";
import type { AuditEntry } from "../api";

export default defineComponent({
  name: "AuditView",
  components: { DataTable, Column, Tag, InputText, IconField, InputIcon },
  data() {
    return { entries: [] as AuditEntry[], filter: "" };
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
    try {
      const res = await apiGet<{ entries: AuditEntry[] }>("/api/audit?limit=200");
      this.entries = res.entries;
    } catch (err) {
      this.$toast.add({
        severity: "error",
        summary: "Failed to load audit log",
        detail: (err as Error).message,
        life: 4000,
      });
    }
  },
});
</script>

<style scoped>
.view-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; gap: 16px; }
.view-head h2 { margin: 0 0 3px; font-size: 18px; font-weight: 500; }
.view-head p { margin: 0; }
.empty { text-align: center; padding: 56px 0; color: var(--mc-muted); }
.empty i { font-size: 36px; opacity: 0.5; }
.empty p { margin: 10px 0 0; }
</style>
