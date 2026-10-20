<template>
  <section class="card" aria-labelledby="mods-catalog-h" :aria-busy="search.searching.value ? 'true' : undefined">
    <div class="card-head">
      <h2 id="mods-catalog-h">{{ t("mods.catalog.title") }}</h2>
      <span class="card-meta">{{ catalogMeta }}</span>
    </div>
    <p class="catalog-lede">{{ t("mods.catalog.lede") }}</p>
    <div class="toolbar catalog-tools">
      <span class="search">
        <i class="pi pi-search" aria-hidden="true" />
        <label class="sr-only" for="mods-catalog-q">{{ t("mods.catalog.search") }}</label>
        <InputText
          id="mods-catalog-q"
          ref="searchInput"
          v-model="search.query.value"
          type="search"
          class="tap"
          :placeholder="t('mods.catalog.searchPlaceholder')"
          @input="search.onQueryInput"
        />
      </span>
      <button
        type="button"
        :class="['chip', 'tap', { on: search.compatible.value }]"
        :aria-pressed="search.compatible.value"
        @click="search.toggleCompatible"
      >
        <i v-if="search.compatible.value" class="pi pi-check chip-check" aria-hidden="true" />
        {{ compatibleLabel }}
      </button>
      <button
        type="button"
        :class="['chip', 'tap', { on: search.hideClientOnly.value }]"
        :aria-pressed="search.hideClientOnly.value"
        @click="search.toggleClientOnly"
      >
        <i v-if="search.hideClientOnly.value" class="pi pi-check chip-check" aria-hidden="true" />
        {{ t("mods.catalog.hideClientOnly") }}
      </button>
      <span class="sort">
        <span id="mods-sort-l" class="small dim">{{ t("mods.catalog.sort") }}</span>
        <Select
          v-model="search.sort.value"
          class="tap"
          :options="sortOptions"
          option-label="label"
          option-value="value"
          label-id="mods-sort"
          aria-labelledby="mods-sort-l"
          @update:model-value="search.resetSearch"
        />
      </span>
    </div>

    <div v-if="(search.searching.value || !search.searched.value) && search.results.value.length === 0" class="skeleton" role="status">
      <span class="sr-only">{{ t("mods.catalog.loading") }}</span>
      <span v-for="n in 3" :key="n" class="sk-row" aria-hidden="true">
        <span class="sk-tile" />
        <span class="sk-lines"><span /><span /></span>
      </span>
    </div>

    <InlineError
      v-else-if="search.searchError.value"
      :title="t('mods.catalog.failed')"
      :recovery="t('mods.catalog.failedRecovery')"
      :detail="search.searchError.value"
      :busy="search.searching.value"
      @retry="search.runSearch"
    />

    <p v-else-if="search.results.value.length === 0" class="none-in-filter small dim">{{ t("mods.catalog.empty") }}</p>

    <template v-else>
      <ul class="cat">
        <li v-for="hit in search.results.value" :key="hit.projectId || hit.slug" class="cat-item">
          <div class="cat-row">
            <ModIcon :name="hit.title || hit.slug" :slug="hit.slug" :src="hit.iconUrl ?? ''" :size="48" decorative />
            <div class="cat-body">
              <div class="cat-title">
                <a :href="hit.pageUrl" target="_blank" rel="noopener noreferrer">{{ hit.title || hit.slug }}</a>
                <span v-if="hit.author" class="cat-by">{{ t("mods.catalog.by", { author: hit.author }) }}</span>
              </div>
              <p class="cat-desc">{{ hit.description }}</p>
              <div class="cat-meta">
                <span class="tag">{{ t(ENVIRONMENT_LABEL[hit.environment] ?? ENVIRONMENT_LABEL.unknown) }}</span>
                <span>{{ t("mods.catalog.downloads", { count: compact(hit.downloads) }) }}</span>
              </div>
            </div>
            <Button
              v-if="hit.installed"
              class="tap cat-action"
              :label="t('mods.catalog.installed')"
              size="small"
              severity="secondary"
              outlined
              disabled
            />
            <Button
              v-else-if="canWrite"
              class="tap cat-action"
              :label="installs.isBusy(hit.slug) ? installs.busyLabel(hit.slug) : t('mods.catalog.add')"
              :icon="search.openSlug.value === hit.slug ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
              icon-pos="right"
              size="small"
              severity="secondary"
              outlined
              :loading="installs.isBusy(hit.slug)"
              :aria-expanded="search.openSlug.value === hit.slug"
              :aria-controls="pickerId(hit.slug)"
              :aria-label="t('mods.catalog.addNamed', { name: hit.title || hit.slug })"
              @click="search.toggleVersions(hit)"
            />
          </div>

          <div v-if="search.openSlug.value === hit.slug" :id="pickerId(hit.slug)" class="picker">
            <div class="picker-head">
              <span class="picker-title">
                <ModIcon :name="hit.title || hit.slug" :slug="hit.slug" :src="hit.iconUrl ?? ''" :size="24" decorative />
                <span class="caps">{{ t("mods.catalog.chooseVersion") }}</span>
              </span>
              <Button
                class="tap"
                :label="t('mods.catalog.installLatest')"
                :aria-label="t('mods.catalog.installLatestNamed', { name: hit.title || hit.slug })"
                size="small"
                :disabled="installs.isLocked(hit.slug)"
                @click="install(hit)"
              />
            </div>
            <p v-if="search.loadingDetail.value" class="small dim" role="status">{{ t("mods.catalog.loadingVersions") }}</p>
            <InlineError
              v-else-if="search.detailError.value"
              :title="t('mods.catalog.versionsFailed')"
              :detail="search.detailError.value"
              :heading-level="4"
              @retry="search.loadDetail(hit)"
            />
            <template v-else-if="search.detail.value">
              <p v-if="search.detail.value.versions.length === 0" class="small dim">{{ t("mods.catalog.noVersions") }}</p>
              <div v-for="v in search.detail.value.versions.slice(0, VERSIONS_SHOWN)" :key="v.id" class="vrow">
                <div class="vinfo">
                  <strong class="mono">{{ v.versionNumber }}</strong>
                  <span class="vmeta">{{ versionMeta(v) }}</span>
                </div>
                <span class="cluster">
                  <span :class="['tag', { 'tag-beta': v.versionType && v.versionType !== 'release' }]">{{ versionTypeLabel(v.versionType) }}</span>
                  <Button
                    class="tap"
                    :label="t('mods.catalog.install')"
                    size="small"
                    severity="secondary"
                    outlined
                    :aria-label="t('mods.catalog.installNamed', { name: hit.title || hit.slug, version: v.versionNumber })"
                    :disabled="installs.isLocked(hit.slug)"
                    @click="install(hit, v)"
                  />
                </span>
              </div>
            </template>
          </div>
        </li>
      </ul>
      <div class="foot">
        <span class="foot-count">{{ t("mods.catalog.results", { count: formatNumber(search.total.value) }) }}</span>
        <PagerNav
          v-if="search.total.value > CATALOG_PAGE"
          :page="search.page.value"
          :pages="search.totalPages.value"
          :label="t('mods.catalog.pagination')"
          :disabled="search.searching.value"
          windowed
          numbered-labels
          @update:page="search.goToPage"
        />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { formatCompact, formatNumber } from "../../utils/numberFormat";
import { computed, nextTick, ref } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import InputText from "primevue/inputtext";
import { t } from "../../i18n";
import type { InstalledMods, ModVersion } from "../../api";
import { ENVIRONMENT_LABEL, useMods } from "../../composables/useMods";
import { CATALOG_PAGE, useModSearch } from "../../composables/useModSearch";
import { useNotify } from "../../composables/useNotify";
import { useRowBusy } from "../../composables/useRowBusy";
import { apiErrorText } from "../../utils/errorMessage";
import { capitalise } from "../../utils/modsFormat";
import InlineError from "../ui/InlineError.vue";
import ModIcon from "../ui/ModIcon.vue";
import PagerNav from "./PagerNav.vue";

const props = defineProps<{
  server: string;
  canWrite: boolean;
  installed: InstalledMods | null;
  /** Called after a successful install so the installed list can reload; the busy state lasts until it settles. */
  afterInstall: (slug: string | undefined) => Promise<void>;
}>();

const VERSIONS_SHOWN = 12;

const mods = useMods(() => props.server);
const notify = useNotify();
const installs = useRowBusy<string>();
const search = useModSearch(mods, () => props.server);
const searchInput = ref<{ $el?: HTMLElement } | null>(null);

const sortOptions = computed(() => [
  { value: "relevance", label: t("mods.catalog.sortRelevance") },
  { value: "downloads", label: t("mods.catalog.sortDownloads") },
  { value: "follows", label: t("mods.catalog.sortFollows") },
  { value: "newest", label: t("mods.catalog.sortNewest") },
  { value: "updated", label: t("mods.catalog.sortUpdated") },
]);

const catalogMeta = computed(() => {
  const list = props.installed;
  if (!search.compatible.value || !list?.modLoader || !list.gameVersion) return t("mods.catalog.metaAny");
  return `${capitalise(list.modLoader)}, ${list.gameVersion}`;
});
const compatibleLabel = computed(() => {
  const version = props.installed?.gameVersion;
  return version ? t("mods.catalog.compatible", { version }) : t("mods.catalog.compatibleAny");
});

function compact(n: number): string {
  return formatCompact(n);
}

function pickerId(slug: string): string {
  return `mods-picker-${slug.replace(/[^\w-]/g, "-")}`;
}

function versionTypeLabel(type: string): string {
  if (type === "beta") return t("mods.catalog.beta");
  if (type === "alpha") return t("mods.catalog.alpha");
  return t("mods.catalog.release");
}

function versionMeta(v: ModVersion): string {
  const parts = [v.gameVersions[0] ?? "", v.loaders.map(capitalise).join(", ")].filter(Boolean);
  if (v.datePublished) {
    parts.push(new Date(v.datePublished).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
  }
  return parts.join(", ");
}

async function focus(): Promise<void> {
  await nextTick();
  const el = searchInput.value?.$el;
  el?.scrollIntoView({ block: "center" });
  el?.focus();
}

async function install(hit: { slug: string; title?: string }, v?: ModVersion): Promise<void> {
  if (installs.isLocked(hit.slug)) return;
  const name = hit.title || hit.slug;
  const server = props.server;
  await installs.run(
    hit.slug,
    async () => {
      try {
        const r = await mods.install({
          slug: hit.slug,
          ...(v?.gameVersions[0] ? { mcVersion: v.gameVersions[0] } : {}),
          ...(v ? { versionId: v.id } : {}),
        });
        if (!r.ok) {
          notify.fail(t("mods.toast.installFailed"), `${name}: ${r.error || t("mods.toast.noDetail")}`);
          return;
        }
        const deps = r.dependencies?.length ?? 0;
        notify.ok(
          deps > 0 ? t("mods.toast.installedDeps", { name, count: deps }) : t("mods.toast.installed", { name }),
          t("mods.toast.restartNote", { server }),
        );
        search.openSlug.value = null;
        if (props.server === server) await Promise.all([props.afterInstall(r.slug), search.runSearch()]);
      } catch (err) {
        notify.fail(t("mods.toast.installFailed"), `${name}: ${apiErrorText(err, t("mods.toast.noDetail"))}`);
      }
    },
    { label: t("mods.busy.install") },
  );
}

defineExpose({ search: search.runSearch, focus, reset: search.reset });
</script>

<style scoped src="./shared.css"></style>
<style scoped>
.sort { display: inline-flex; align-items: center; gap: var(--space-2); }
.catalog-lede { margin: calc(-1 * var(--space-2)) 0 var(--space-3); color: var(--text-dim); font-size: var(--text-sm); }

.cat { list-style: none; margin: 0 calc(-1 * var(--space-4)); padding: 0; }
.cat-item { border-top: 1px solid var(--border); }
.cat-item:first-child { border-top: 0; }
.cat-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
}
.cat-body { min-width: 0; }
.cat-title { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; }
.cat-title a { color: var(--text); font-weight: 600; text-underline-offset: 2px; overflow-wrap: anywhere; }
.cat-by { font-size: var(--text-xs); color: var(--text-dim); }
.cat-desc {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cat-meta { display: flex; flex-wrap: wrap; gap: 0 var(--space-3); margin-top: 2px; font-size: var(--text-xs); color: var(--text-dim); }

.picker {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--surface-raised);
}
.picker p { margin: 0; }
.picker-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); }
.picker-title { display: inline-flex; align-items: center; gap: var(--space-2); }
.vrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border);
}
.vinfo { display: grid; min-width: 0; }
.vinfo strong { overflow-wrap: anywhere; }
.vmeta { font-size: var(--text-xs); color: var(--text-dim); }
.tag {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text-dim);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.tag-beta { background: var(--st-degraded-bg); color: var(--st-degraded); }

@container (min-width: 1900px) {
  .cat { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cat-item:nth-child(2) { border-top: 0; }
  .cat-item:nth-child(even) { border-left: 1px solid var(--border); }
}
@media (max-width: 760px) {
  .cat-row { grid-template-columns: auto minmax(0, 1fr); }
  .cat-row > .cat-action { grid-column: 1 / -1; }
  .cat-title a { display: inline-flex; align-items: center; min-height: var(--touch-min); }
  .vrow { grid-template-columns: minmax(0, 1fr); }
}
</style>
