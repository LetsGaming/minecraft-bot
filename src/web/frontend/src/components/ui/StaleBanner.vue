<template>
  <InlineBanner v-if="stale" tone="warn" class="stale-banner">
    <span class="stale-text">
      <slot>
        Showing the last data we could read, from
        <strong :title="timestampTitle(stale.asOf)">{{ relativeAge(stale.asOf) }}</strong>.
        The wrapper isn't answering, so this may have changed since.
      </slot>
      <span v-if="writeNote" class="stale-write">{{ writeNote }}</span>
    </span>
    <span v-if="stale.reason" class="stale-reason small" :title="stale.reason">
      {{ stale.reason }}
    </span>
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
  </InlineBanner>
</template>

<script setup lang="ts">
import InlineBanner from "./InlineBanner.vue";
import { relativeAge, timestampTitle } from "../../utils/time";
import type { StaleInfo } from "@mcbot/schema/contract.js";

/**
 * The visible half of serving last-known data.
 *
 * Falling back to a cached read is only an improvement over a 502 if the
 * reader knows it happened. Stale data presented as current is a worse
 * failure than the error it replaces: an operator who believes a config
 * listing is live will act on it. So this is deliberately loud: warning tone,
 * the age stated in words rather than implied, and the underlying wrapper
 * error kept visible instead of swallowed, because that error is the thing
 * someone actually has to go and fix.
 *
 * `writeNote` exists because reads and writes degrade differently: the read
 * fell back, the write cannot. The default slot replaces the generic sentence
 * for a view that can say what exactly is old.
 */
defineProps<{
  stale?: StaleInfo | null;
  /** What the reader should expect if they try to change something. */
  writeNote?: string;
}>();
</script>

<style scoped>
.stale-banner { margin-bottom: 14px; }
.stale-text { display: block; max-width: 78ch; }
.stale-write { display: block; margin-top: 4px; }
.stale-reason {
  display: block;
  margin-top: 4px;
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 78ch;
}
</style>
