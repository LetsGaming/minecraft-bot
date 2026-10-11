<template>
  <StatusChip :state="role" variant="dot" :label="label" />
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { StatusRole } from "@mcbot/schema";
import StatusChip from "./StatusChip.vue";

type DotState = "up" | "down" | "stale";

// The shape-only status for servers and the bot process, drawn by StatusChip.
//   up    = healthy / answering
//   down  = confirmed stopped
//   stale = up but not answering, or state unknown (wrapper unreachable,
//           heartbeat lost). Deliberately not the offline role: nothing is
//           confirmed down.
const ROLE: Record<DotState, StatusRole> = {
  up: StatusRole.Online,
  down: StatusRole.Offline,
  stale: StatusRole.Degraded,
};

export default defineComponent({
  name: "StatusDot",
  components: { StatusChip },
  props: {
    state: { type: String as PropType<DotState>, default: "down" },
    /** Read by assistive tech and shown as the tooltip; defaults to the role's label. */
    label: { type: String, default: "" },
  },
  computed: {
    role(): StatusRole {
      return ROLE[this.state] ?? StatusRole.Unknown;
    },
  },
});
</script>
