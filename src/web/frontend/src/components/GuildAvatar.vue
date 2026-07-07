<template>
  <img
    v-if="iconHash"
    :src="iconUrl"
    :style="sizeStyle"
    class="guild-avatar"
    alt=""
  />
  <span v-else class="guild-avatar placeholder" :style="sizeStyle">{{ initial }}</span>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useGuilds } from "../composables/useGuilds";

// Renders a guild's Discord icon, or a coloured initial when there's no
// icon (or the name isn't known yet). Self-contained: it resolves the
// name and icon from the shared useGuilds cache, so callers only pass an
// ID and a size.
export default defineComponent({
  name: "GuildAvatar",
  props: {
    guildId: { type: String, required: true },
    size: { type: Number, default: 32 },
  },
  setup() {
    const { guildName, guildIcon } = useGuilds();
    return { guildName, guildIcon };
  },
  computed: {
    iconHash(): string | null {
      return this.guildIcon(this.guildId);
    },
    iconUrl(): string {
      return `https://cdn.discordapp.com/icons/${this.guildId}/${this.iconHash}.png?size=64`;
    },
    initial(): string {
      return this.guildName(this.guildId).charAt(0).toUpperCase();
    },
    sizeStyle(): Record<string, string> {
      return {
        width: `${this.size}px`,
        height: `${this.size}px`,
        borderRadius: `${Math.round(this.size * 0.26)}px`,
        fontSize: `${Math.round(this.size * 0.44)}px`,
      };
    },
  },
});
</script>

<style scoped>
.guild-avatar { flex: none; object-fit: cover; }
.guild-avatar.placeholder {
  display: grid; place-items: center;
  background: #1e2b22; border: 0.5px solid var(--mc-accent-border);
  color: var(--mc-accent); font-weight: 600;
}
</style>
