<template>
  <div :class="['app-shell', { 'drawer-open': drawerActive }]">
    <a class="skip" href="#main" @click.prevent="focusMain">{{ t("shell.skip") }}</a>

    <div
      v-if="drawerActive"
      class="scrim"
      aria-hidden="true"
      @click="closeDrawer(true)"
    />

    <div
      id="app-nav"
      ref="side"
      class="side"
      :role="drawerActive ? 'dialog' : undefined"
      :aria-modal="drawerActive ? 'true' : undefined"
      :aria-label="drawerActive ? t('shell.navigation') : undefined"
      @keydown="onSideKeydown"
    >
      <aside class="side__inner" :aria-label="t('shell.sidebar')">
        <div class="brand">
          <span class="brand__mark" aria-hidden="true"><i class="pi pi-box" /></span>
          <span class="brand__name">{{ t("app.name") }}</span>
          <button
            v-if="drawerActive"
            type="button"
            class="icon-btn brand__close"
            :aria-label="t('shell.menuClose')"
            @click="closeDrawer(true)"
          >
            <i class="pi pi-times" aria-hidden="true" />
          </button>
        </div>

        <div v-if="showServerPicker" class="server-pick">
          <span id="shell-server-label" class="side-label">{{ t("term.server") }}</span>
          <Select
            v-if="servers.length > 0"
            :model-value="activeServer"
            :options="servers"
            option-label="id"
            option-value="id"
            append-to="self"
            aria-labelledby="shell-server-label"
            class="server-pick__select"
            @update:model-value="$emit('switch-server', $event)"
          >
            <template #value="{ value }">
              <span v-if="activeStatus" class="server-opt">
                <StatusDot :state="statusDot(activeStatus)" />
                <span class="mono server-opt__id">{{ value }}</span>
                <span v-if="tpsOf(activeStatus)" class="server-opt__tps">{{ tpsOf(activeStatus) }}</span>
              </span>
              <span v-else class="mono">{{ value }}</span>
            </template>
            <template #option="{ option }">
              <span class="server-opt">
                <StatusDot :state="statusDot(option)" />
                <span class="mono server-opt__id">{{ option.id }}</span>
                <span v-if="tpsOf(option)" class="server-opt__tps">{{ tpsOf(option) }}</span>
              </span>
            </template>
          </Select>
          <span v-else class="side-empty">{{ t("shell.noServers") }}</span>
        </div>

        <nav class="nav" :aria-label="t('shell.mainNav')">
          <div v-for="group in groups" :key="group.id" class="nav-group">
            <div :id="`nav-group-${group.id}`" class="side-label">{{ group.label }}</div>
            <ul class="nav-list" :aria-labelledby="`nav-group-${group.id}`">
              <li v-for="item in group.items" :key="item.id">
                <RouterLink v-slot="{ href, navigate }" :to="item.to" custom>
                  <a
                    :href="href"
                    class="nav-link"
                    :aria-current="item.active ? 'page' : undefined"
                    @click="onNavClick($event, navigate)"
                  >
                    <i :class="item.icon" aria-hidden="true" />
                    <span>{{ item.label }}</span>
                  </a>
                </RouterLink>
              </li>
            </ul>
          </div>
        </nav>

        <div class="side__foot">
          <div class="invite">
            <Button
              :label="t('shell.invite')"
              icon="pi pi-plus-circle"
              severity="secondary"
              class="invite__btn"
              :loading="inviting"
              @click="$emit('invite')"
            />
            <p class="side-hint">{{ t("shell.inviteHint") }}</p>
          </div>
          <div class="foot-row">
            <span id="shell-density-label">{{ t("shell.density") }}</span>
            <span class="seg" role="group" aria-labelledby="shell-density-label">
              <button
                v-for="option in densityOptions"
                :key="option.value"
                type="button"
                :aria-pressed="density === option.value ? 'true' : 'false'"
                @click="setDensity(option.value)"
              >
                {{ option.label }}
              </button>
            </span>
          </div>
          <div class="foot-row">
            <span class="who">{{ t("shell.signedInAs", { name: userTag }) }}</span>
            <button
              type="button"
              class="icon-btn"
              :aria-label="t('shell.logout')"
              :title="t('shell.logout')"
              @click="$emit('logout')"
            >
              <i class="pi pi-sign-out" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </div>

    <div class="main-col" :inert="drawerActive">
      <header class="topbar">
        <button
          ref="menuButton"
          type="button"
          class="icon-btn icon-btn--touch"
          aria-controls="app-nav"
          :aria-expanded="drawerOpen ? 'true' : 'false'"
          :aria-label="t('shell.menuOpen')"
          @click="openDrawer"
        >
          <i class="pi pi-bars" aria-hidden="true" />
        </button>
        <span class="topbar__title">{{ title }}</span>
        <span v-if="activeStatus" class="topbar__server">
          <StatusDot :state="statusDot(activeStatus)" />
          <span class="mono">{{ activeStatus.id }}</span>
        </span>
      </header>

      <div v-if="$slots.status" class="status-line" role="status">
        <slot name="status" />
      </div>

      <main id="main" ref="main" class="content" tabindex="-1">
        <div class="page">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";
import { RouterLink, useRoute, type RouteLocationRaw } from "vue-router";
import Button from "primevue/button";
import Select from "primevue/select";
import StatusDot from "./StatusDot.vue";
import type { ServerStatus } from "../../api";
import { stateIsUp } from "@mcbot/schema/serverState.js";
import { statusDot } from "../../utils/format";
import { useDensity, type Density } from "../../composables/useDensity";
import { t } from "../../i18n";

export interface ShellNavItem {
  id: string;
  label: string;
  icon: string;
  to: RouteLocationRaw;
  active: boolean;
}

export interface ShellNavGroup {
  id: string;
  label: string;
  items: ShellNavItem[];
}

const NARROW_QUERY = "(max-width: 760px)";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const props = defineProps({
  groups: { type: Array as PropType<ShellNavGroup[]>, required: true },
  title: { type: String, default: "" },
  servers: { type: Array as PropType<ServerStatus[]>, default: () => [] },
  activeServer: { type: String, default: "" },
  showServerPicker: { type: Boolean, default: false },
  userTag: { type: String, default: "" },
  inviting: { type: Boolean, default: false },
});

defineEmits<{
  "switch-server": [id: string];
  invite: [];
  logout: [];
}>();

const route = useRoute();
const { density, setDensity } = useDensity();

const densityOptions: { value: Density; label: string }[] = [
  { value: "comfortable", label: t("shell.densityComfortable") },
  { value: "compact", label: t("shell.densityCompact") },
];

const side = ref<HTMLElement | null>(null);
const main = ref<HTMLElement | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);

const drawerOpen = ref(false);
const narrow = ref(false);
let media: MediaQueryList | null = null;

const drawerActive = computed(() => drawerOpen.value && narrow.value);

const activeStatus = computed(
  () => props.servers.find((s) => s.id === props.activeServer) ?? null,
);

function tpsOf(server: ServerStatus): string {
  return stateIsUp(server.state) && server.tps !== null
    ? t("shell.tps", { tps: server.tps.toFixed(0) })
    : "";
}

function onMediaChange(): void {
  narrow.value = media?.matches ?? false;
  if (!narrow.value) drawerOpen.value = false;
}

onMounted(() => {
  if (typeof window.matchMedia !== "function") return;
  media = window.matchMedia(NARROW_QUERY);
  onMediaChange();
  media.addEventListener("change", onMediaChange);
});

onBeforeUnmount(() => {
  media?.removeEventListener("change", onMediaChange);
});

function focusables(): HTMLElement[] {
  return Array.from(side.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
    (el) => el.offsetParent !== null,
  );
}

async function openDrawer(): Promise<void> {
  drawerOpen.value = true;
  await nextTick();
  const current = side.value?.querySelector<HTMLElement>('[aria-current="page"]');
  (current ?? focusables()[0])?.focus();
}

function closeDrawer(returnFocus: boolean): void {
  if (!drawerOpen.value) return;
  drawerOpen.value = false;
  if (returnFocus) void nextTick(() => menuButton.value?.focus());
}

function onSideKeydown(event: KeyboardEvent): void {
  if (!drawerActive.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeDrawer(true);
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables();
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusMain(): void {
  main.value?.focus();
}

function onNavClick(event: MouseEvent, navigate: (e?: MouseEvent) => unknown): void {
  // Modified clicks open the link elsewhere and leave this page as it is.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  void navigate(event);
}

// A new view or server starts at the top with the drawer closed and focus in
// the content, because below 760px the page itself scrolls and the old
// position would make the change look like it did nothing.
watch(
  () => [route.meta.nav, route.params.server],
  (next, prev) => {
    if (next[0] === prev[0] && next[1] === prev[1]) return;
    const wasOpen = drawerActive.value;
    drawerOpen.value = false;
    window.scrollTo(0, 0);
    main.value?.scrollTo?.(0, 0);
    if (wasOpen) void nextTick(focusMain);
  },
);
</script>

<style scoped>
.app-shell {
  --side-w: 232px;
  display: grid;
  grid-template-columns: var(--side-w) minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
}

.skip {
  position: absolute;
  left: var(--space-3);
  top: -60px;
  z-index: calc(var(--z-toast) + 1);
  background: var(--accent);
  color: var(--on-accent);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  font-weight: 600;
  text-decoration: none;
}
.skip:focus { top: var(--space-2); }

.side {
  background: var(--surface-nav);
  border-right: 1px solid var(--border);
  padding: var(--space-3);
  overflow-y: auto;
  min-height: 0;
}
.side__inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 100%;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  font-weight: 600;
  font-size: var(--text-lg);
  min-height: var(--control-h);
}
.brand__mark {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-control);
  display: grid;
  place-items: center;
  background: var(--accent);
  color: var(--on-accent);
  font-size: var(--text-sm);
  flex: none;
}
.brand__name { flex: 1; min-width: 0; }

.side-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  color: var(--text-dim);
  padding: var(--space-2) var(--space-2) var(--space-1);
}
.side-empty { font-size: var(--text-sm); color: var(--text-dim); padding: 0 var(--space-2); }
.side-hint { margin: var(--space-1) var(--space-1) 0; font-size: var(--text-xs); color: var(--text-dim); line-height: 1.4; }

.server-pick { display: grid; }
.server-pick__select { width: 100%; }
.server-opt { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
.server-opt__id { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.server-opt__tps { font-size: var(--text-xs); color: var(--text-dim); white-space: nowrap; }

.nav { display: grid; gap: var(--space-2); }
.nav-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.nav-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-h);
  padding: 0 var(--space-2);
  border-radius: var(--radius-control);
  border-left: 3px solid transparent;
  color: var(--text);
  text-decoration: none;
  font-size: var(--text-md);
  transition: background-color var(--dur-fast);
}
.nav-link i { width: 18px; font-size: var(--text-lg); color: var(--text-dim); }
.nav-link:hover { background: var(--surface-raised); }
.nav-link[aria-current="page"] {
  background: var(--accent-tint);
  border-left-color: var(--accent);
  font-weight: 500;
}
.nav-link[aria-current="page"] i { color: var(--accent); }

.side__foot {
  margin-top: auto;
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}
.invite__btn { width: 100%; }
.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-dim);
}
.who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.seg {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  overflow: hidden;
  background: var(--bg);
}
.seg button {
  min-height: var(--control-h);
  padding: 0 var(--space-3);
  background: none;
  border: 0;
  cursor: pointer;
  color: var(--text-dim);
  font: inherit;
  font-weight: 500;
}
.seg button + button { border-left: 1px solid var(--border); }
.seg button[aria-pressed="true"] {
  background: var(--accent-tint);
  color: var(--text);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  min-width: var(--control-h);
  min-height: var(--control-h);
  border: 0;
  border-radius: var(--radius-control);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.icon-btn:hover { background: var(--surface-raised); color: var(--text); }
.icon-btn--touch { min-width: var(--touch-min); min-height: var(--touch-min); }

.main-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }

.topbar { display: none; }

.status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) var(--space-5);
  background: var(--st-degraded-bg);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: var(--text-sm);
}

.content { flex: 1; min-height: 0; overflow-y: auto; }
.content:focus { outline: none; }
.page {
  width: 100%;
  max-width: var(--page-max);
  min-height: 100%;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5) var(--space-7);
  display: flex;
  flex-direction: column;
}
/* A view that opts into filling (`.view-fill`) takes the leftover height;
   `min-height: 0` is what lets an inner pane scroll instead of stretching. */
.page > :deep(.view-fill) { flex: 1; min-height: 0; }

@media (max-width: 760px) {
  .app-shell { display: block; height: auto; overflow: visible; }

  .side {
    position: fixed;
    z-index: var(--z-nav);
    inset: 0 auto 0 0;
    width: min(86vw, 320px);
    transform: translateX(-102%);
    visibility: hidden;
    transition:
      transform var(--dur-state) var(--ease-settle),
      visibility 0s linear var(--dur-state);
    box-shadow: var(--shadow-overlay);
  }
  .drawer-open .side { transform: none; visibility: visible; transition-delay: 0s; }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-nav) - 1);
    background: var(--scrim);
  }

  .nav-link, .seg button, .icon-btn { min-height: var(--touch-min); }
  .icon-btn { min-width: var(--touch-min); }

  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    min-height: 56px;
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-1);
    background: var(--surface-nav);
    border-bottom: 1px solid var(--border);
  }
  .topbar__title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topbar__server {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 45%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    overflow: hidden;
    white-space: nowrap;
  }

  .status-line { padding: var(--space-2) var(--space-4); }
  .content { overflow: visible; }
  .page { padding: var(--space-4) var(--space-4) 96px; }
}

@media (prefers-reduced-motion: reduce) {
  .side, .nav-link { transition: none; }
}
</style>
