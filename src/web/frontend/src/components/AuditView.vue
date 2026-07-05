<template>
  <div>
    <table class="audit">
      <thead>
        <tr>
          <th>When</th>
          <th>Action</th>
          <th>Server</th>
          <th>By</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(entry, i) in entries" :key="i">
          <td class="muted">{{ entry.at }}</td>
          <td>{{ entry.action }}</td>
          <td>{{ entry.server ?? "—" }}</td>
          <td>{{ entry.by }}</td>
          <td class="muted">{{ entry.detail ?? "" }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!entries.length" class="muted center">No audit entries yet.</p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet } from "../api";
import type { AuditEntry } from "../api";

export default defineComponent({
  name: "AuditView",
  data() {
    return { entries: [] as AuditEntry[] };
  },
  async mounted() {
    const res = await apiGet<{ entries: AuditEntry[] }>("/api/audit?limit=200");
    this.entries = res.entries;
  },
});
</script>
