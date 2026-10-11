<template>
  <div class="mods">
    <header class="mods-head">
      <div>
        <h1>Mods</h1>
        <p>
          Install, update and remove mods on <b>{{ serverId || "—" }}</b
          >.
        </p>
      </div>
      <div class="head-actions">
        <button class="btn" :disabled="checking || !serverId" @click="checkNow">
          <i class="pi pi-refresh" :class="{ spin: checking }" /> Check for
          updates
        </button>
        <button
          v-if="canWrite && updateCount > 0"
          class="btn green"
          :disabled="applyingAll"
          @click="applyAll"
        >
          <i class="pi pi-arrow-circle-up" /> Apply all
          <span class="badge">{{ updateCount }}</span>
        </button>
      </div>
    </header>

    <section v-if="installed?.compat" class="compat">
      <div class="compat-h">
        <i class="pi pi-sync" /> Check another Minecraft version
      </div>
      <div class="compat-row">
        <select
          v-if="!useCustom"
          v-model="selectedVersion"
          class="select"
          :disabled="checkingCompat || loadingVersions"
          aria-label="Target Minecraft version"
        >
          <option v-for="v in versionChoices" :key="v" :value="v">
            {{ v }}{{ v === installed.gameVersion ? " (installed)" : "" }}
          </option>
        </select>
        <input
          v-else
          v-model="customVersion"
          class="compat-input"
          placeholder="e.g. 1.21.5"
          :disabled="checkingCompat"
          aria-label="Target Minecraft version"
          @keyup.enter="checkVersion()"
        />
        <button
          class="linkbtn"
          :disabled="checkingCompat"
          @click="useCustom = !useCustom"
        >
          {{ useCustom ? "Pick from list" : "Type a version" }}
        </button>
        <button
          class="btn"
          :disabled="checkingCompat || !targetValid"
          @click="checkVersion()"
        >
          <i class="pi pi-search" :class="{ spin: checkingCompat }" /> Check
        </button>
        <button
          v-if="compatJob?.state === 'done'"
          class="linkbtn"
          :disabled="checkingCompat"
          title="Ask Modrinth again instead of using the saved answer"
          @click="checkVersion(true)"
        >
          Check again
        </button>
      </div>
      <p v-if="loadingVersions" class="empty sm">Loading Minecraft versions…</p>
      <p v-else-if="checkingCompat" class="empty sm" role="status">
        {{ progressText }}
      </p>
      <p v-else-if="compatFailed" class="msg err" role="alert">
        The check for {{ checkedVersion }} failed.
        {{ compatJob?.error ?? "" }}
      </p>
      <p v-else-if="compatEmpty" class="empty sm">
        No mods installed, so there is nothing to check.
      </p>
      <p v-else-if="compatDone && compatStale" class="msg stale">
        These results are for the mods installed when you checked. Check again
        to refresh them.
      </p>
      <div v-if="compatDone && !compatEmpty" class="compat-filter">
        <span class="muted">Minecraft {{ checkedVersion }}</span>
        <button
          class="chip"
          :class="{ on: compatFilter === 'all' }"
          @click="compatFilter = 'all'"
        >
          All
        </button>
        <button
          class="chip"
          :class="{ on: compatFilter === 'blockers' }"
          @click="compatFilter = 'blockers'"
        >
          Only blockers
        </button>
      </div>
    </section>

    <div class="stats">
      <div class="stat">
        <div class="n">{{ installed?.mods.length ?? "—" }}</div>
        <div class="l">installed mods</div>
      </div>
      <div class="stat">
        <div class="n mono">{{ installed?.gameVersion ?? "—" }}</div>
        <div class="l">minecraft version</div>
      </div>
      <div class="stat">
        <div class="n cap">{{ installed?.modLoader ?? "—" }}</div>
        <div class="l">mod loader</div>
      </div>
      <div class="stat" :class="{ warn: updateCount > 0 }">
        <div class="n">{{ updateCount }}</div>
        <div class="l">updates available</div>
      </div>
      <div
        v-if="compatSummaryText"
        class="stat compat-stat"
        :class="{ warn: (compatSummary?.unavailable ?? 0) > 0 }"
      >
        <div class="n sm">{{ compatSummaryText }}</div>
        <div class="l">for Minecraft {{ checkedVersion }}</div>
      </div>
    </div>

    <div class="grid">
      <!-- Browse / Add (primary) -->
      <section class="card">
        <div class="card-h">
          <div class="t"><i class="pi pi-search" /> Add from Modrinth</div>
          <div class="a muted">catalogue</div>
        </div>
        <div class="browse-top">
          <div class="search">
            <i class="pi pi-search" />
            <input
              v-model="query"
              placeholder="Search mods…"
              @input="onQueryInput"
            />
          </div>
          <div class="browse-controls">
            <label class="toggle"
              ><input
                type="checkbox"
                v-model="compatible"
                @change="resetSearch"
              />
              <span class="sw" /> Compatible with
              {{ installed?.gameVersion ?? "any" }} ·
              {{ installed?.modLoader ?? "any" }}</label
            >
            <select v-model="sort" class="select" @change="resetSearch">
              <option value="relevance">Relevance</option>
              <option value="downloads">Downloads</option>
              <option value="follows">Follows</option>
              <option value="newest">Newest</option>
              <option value="updated">Updated</option>
            </select>
          </div>
          <div class="browse-controls">
            <label class="toggle"
              ><input
                type="checkbox"
                v-model="hideClientOnly"
                @change="resetSearch"
              />
              <span class="sw" /> Hide client-only mods</label
            >
          </div>
        </div>

        <div class="results">
          <p v-if="searching" class="empty">Searching…</p>
          <p v-else-if="results.length === 0" class="empty">No results.</p>

          <div
            v-for="hit in results"
            :key="hit.projectId"
            class="item"
            :class="{ open: openSlug === hit.slug }"
          >
            <div class="result">
              <div class="ricon" :style="iconStyle(hit)">
                <img v-if="hit.iconUrl" :src="hit.iconUrl" alt="" />
                <span v-else>{{ hit.title.charAt(0) }}</span>
              </div>
              <div class="info">
                <div class="rt">
                  <a :href="hit.pageUrl" target="_blank" rel="noopener"
                    ><b>{{ hit.title }}</b></a
                  >
                  <span class="by">by {{ hit.author }}</span>
                </div>
                <div class="rd">{{ hit.description }}</div>
                <div class="meta">
                  <span class="env"
                    ><span
                      class="d"
                      :style="{ background: env(hit.environment).color }"
                    />
                    {{ env(hit.environment).label }}</span
                  >
                  <span class="dl"
                    ><i class="pi pi-download" /> {{ fmt(hit.downloads) }}</span
                  >
                </div>
              </div>
              <a
                class="extlink"
                :href="hit.pageUrl"
                target="_blank"
                rel="noopener"
                title="Open on Modrinth"
                ><i class="pi pi-external-link"
              /></a>
              <button v-if="hit.installed" class="add installed" disabled>
                Installed
              </button>
              <button
                v-else-if="canWrite"
                class="add"
                :disabled="busy.has(hit.slug)"
                @click="toggleVersions(hit)"
              >
                {{ busy.has(hit.slug) ? "…" : "Add" }}
                <i
                  class="pi"
                  :class="
                    openSlug === hit.slug ? 'pi-chevron-up' : 'pi-chevron-down'
                  "
                />
              </button>
            </div>

            <!-- version picker -->
            <div v-if="openSlug === hit.slug" class="picker">
              <div class="picker-h">
                <span class="lbl">CHOOSE VERSION</span>
                <button
                  class="install ghost sm"
                  :disabled="busy.has(hit.slug)"
                  @click="installLatest(hit)"
                >
                  Install latest compatible
                </button>
              </div>
              <p v-if="loadingDetail" class="empty sm">Loading versions…</p>
              <template v-else-if="detail">
                <p v-if="detail.versions.length === 0" class="empty sm">
                  No versions for this loader.
                </p>
                <div
                  v-for="v in detail.versions.slice(0, 12)"
                  :key="v.id"
                  class="vrow"
                >
                  <span class="vv">{{ v.versionNumber }}</span>
                  <span class="gt">{{ v.gameVersions[0] }}</span>
                  <span
                    class="ty"
                    :class="{ beta: v.versionType !== 'release' }"
                    >{{ label(v.versionType) }}</span
                  >
                  <span class="dt">{{ date(v.datePublished) }}</span>
                  <button
                    class="install"
                    :disabled="busy.has(hit.slug)"
                    @click="installVersion(hit, v)"
                  >
                    Install
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div class="foot">
          <span>Modrinth · {{ total }} results</span>
          <span v-if="total > PAGE" class="pager">
            <button
              class="pg"
              :disabled="offset === 0 || searching"
              @click="prevPage"
            >
              <i class="pi pi-chevron-left" />
            </button>
            <span class="pg-info">Page {{ page }} / {{ totalPages }}</span>
            <button
              class="pg"
              :disabled="offset + PAGE >= total || searching"
              @click="nextPage"
            >
              <i class="pi pi-chevron-right" />
            </button>
          </span>
        </div>
      </section>

      <!-- Installed -->
      <section class="card">
        <div class="card-h">
          <div class="t"><i class="pi pi-box" /> Installed mods</div>
          <div class="a muted">{{ installed?.mods.length ?? 0 }} mods</div>
        </div>
        <p v-if="loadingInstalled" class="empty">Loading…</p>
        <p v-else-if="!installed || installed.mods.length === 0" class="empty">
          No mods installed.
        </p>
        <div v-else class="scroll-body">
          <table>
            <thead>
              <tr>
                <th>MOD</th>
                <th>VERSION</th>
                <th>STATUS</th>
                <th v-if="showCompatColumn">
                  {{ checkedVersion ? "MC " + checkedVersion : "COMPAT" }}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="visibleMods.length === 0">
                <td :colspan="showCompatColumn ? 5 : 4" class="empty sm">
                  No blockers for Minecraft {{ checkedVersion }}.
                </td>
              </tr>
              <template v-for="m in visibleMods" :key="m.slug">
              <tr :class="{ 'row-disabled': isDisabled(m) }">
                <td>
                  <div class="mod-name">{{ m.slug }}</div>
                  <div class="mod-file">{{ m.filename ?? "—" }}</div>
                </td>
                <td>
                  <span class="ver">{{ shortVersion(m.versionId) }}</span>
                </td>
                <td>
                  <span
                    v-if="isDisabled(m)"
                    class="pill off"
                    title="Disabled mods only take effect on the next server start"
                    >⏸ disabled</span
                  >
                  <span v-else-if="update(m.slug)" class="pill up"
                    >↑ update</span
                  >
                  <span v-else class="pill ok">✓ up to date</span>
                </td>
                <td v-if="showCompatColumn">
                  <button
                    v-if="compatFor(m.slug)"
                    class="pill compat-badge"
                    :class="'c-' + compatFor(m.slug)!.availability"
                    :aria-expanded="openCompat === m.slug"
                    @click="openCompat = openCompat === m.slug ? null : m.slug"
                  >
                    {{ compatLabel(compatFor(m.slug)!.availability) }}
                  </button>
                  <span v-else-if="checkingCompat" class="muted small">…</span>
                  <span v-else class="muted small">—</span>
                </td>
                <td>
                  <div class="row-actions">
                    <button
                      v-if="canWrite && update(m.slug)"
                      class="mini update"
                      :disabled="busy.has(m.slug)"
                      @click="updateOne(m.slug)"
                    >
                      Update
                    </button>
                    <button
                      v-if="canWrite"
                      class="mini toggle"
                      :disabled="busy.has(m.slug)"
                      :title="
                        isDisabled(m)
                          ? 'Enable (takes effect on next restart)'
                          : 'Disable without uninstalling (takes effect on next restart)'
                      "
                      @click="doToggle(m)"
                    >
                      {{ isDisabled(m) ? "Enable" : "Disable" }}
                    </button>
                    <a
                      class="extlink"
                      :href="'https://modrinth.com/mod/' + m.slug"
                      target="_blank"
                      rel="noopener"
                      title="Open on Modrinth"
                      ><i class="pi pi-external-link"
                    /></a>
                    <button
                      v-if="canWrite"
                      class="mini remove"
                      :disabled="busy.has(m.slug)"
                      title="Remove"
                      @click="doRemove(m.slug)"
                    >
                      <i class="pi pi-trash" />
                    </button>
                  </div>
                </td>
              </tr>
              <tr
                v-if="openCompat === m.slug && compatFor(m.slug)"
                class="compat-detail"
              >
                <td :colspan="5">
                  <template v-if="compatFor(m.slug)!.availability === 'available'">
                    <template v-if="compatFor(m.slug)!.target">
                      Release for Minecraft {{ checkedVersion }}:
                      <b>{{ compatFor(m.slug)!.target!.versionName }}</b>
                      <span v-if="compatFor(m.slug)!.target!.datePublished">
                        , published
                        {{ date(compatFor(m.slug)!.target!.datePublished) }}</span
                      >.
                      <a
                        v-if="compatFor(m.slug)!.target!.downloadUrl"
                        :href="compatFor(m.slug)!.target!.downloadUrl"
                        target="_blank"
                        rel="noopener"
                        >Download</a
                      >
                    </template>
                    <template v-else>
                      The installed build is already the newest release for
                      Minecraft {{ checkedVersion }}.
                    </template>
                  </template>
                  <template v-else>
                    {{ compatFor(m.slug)!.reason ?? "No details." }}
                  </template>
                </td>
              </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useMods, ENVIRONMENT_META } from "../composables/useMods";
import { useModCompat } from "../composables/useModCompat";
import { useCapabilities } from "../composables/useCapabilities";
import { useToast } from "primevue/usetoast";
import { UnauthorizedError } from "../api";
import type {
  InstalledMods,
  InstalledMod,
  ModSearchHit,
  ModVersion,
  ModProjectDetail,
} from "../api";

const props = defineProps<{ activeServer: string }>();
const serverId = computed(() => props.activeServer);

const mods = useMods(() => props.activeServer);
const { can } = useCapabilities();
const toast = useToast();
const canWrite = computed(() => can("mods:write", props.activeServer));

const installed = ref<InstalledMods | null>(null);
const loadingInstalled = ref(false);
const updates = ref<Map<string, string>>(new Map());
const checking = ref(false);
const applyingAll = ref(false);

const query = ref("");
const sort = ref("relevance");
const compatible = ref(true);
const hideClientOnly = ref(true);
const results = ref<ModSearchHit[]>([]);
const total = ref(0);
const searching = ref(false);

const openSlug = ref<string | null>(null);
const detail = ref<ModProjectDetail | null>(null);
const loadingDetail = ref(false);

const busy = ref<Set<string>>(new Set());

// Pagination for the browse results.
const PAGE = 20;
const offset = ref(0);
const page = computed(() => Math.floor(offset.value / PAGE) + 1);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)));

const updateCount = computed(() => updates.value.size);

const compat = useModCompat({
  api: {
    start: (v, refresh) => mods.compatStart(v, refresh),
    poll: (id) => mods.compatPoll(id),
    versions: () => mods.compatVersions(),
  },
  installedVersion: () => installed.value?.gameVersion,
  onError: (text) => flash("err", text),
});
const {
  selected: selectedVersion,
  customVersion,
  useCustom,
  versionChoices,
  targetValid,
  loadingVersions,
  checkingCompat,
  job: compatJob,
  checkedVersion,
  stale: compatStale,
  filter: compatFilter,
  progressText,
  summary: compatSummary,
  summaryText: compatSummaryText,
  failed: compatFailed,
  hasResult: compatDone,
  emptyResult: compatEmpty,
  forSlug: compatFor,
} = compat;

const openCompat = ref<string | null>(null);
const showCompatColumn = computed(
  () => compat.rows.value.length > 0 || checkingCompat.value,
);
const visibleMods = computed(() => {
  const all = installed.value?.mods ?? [];
  if (compatFilter.value !== "blockers" || !compatDone.value) return all;
  return all.filter((m) => compat.isBlocker(m.slug));
});

function compatLabel(a: "available" | "unavailable" | "unknown"): string {
  if (a === "available") return "✓ ready";
  if (a === "unavailable") return "✕ missing";
  return "? unknown";
}

/** What a finished check was computed from: slug, build and enabled state. */
function installedSignature(list: InstalledMods | null): string {
  return (list?.mods ?? [])
    .map((m) => `${m.slug}:${m.versionId ?? ""}:${m.enabled === false ? 0 : 1}`)
    .sort()
    .join("|");
}
let checkedSignature = "";

function checkVersion(refresh = false) {
  checkedSignature = installedSignature(installed.value);
  openCompat.value = null;
  return compat.check(refresh);
}

watch(installed, (next) => {
  if (compatDone.value && installedSignature(next) !== checkedSignature) {
    compat.markStale();
  }
});

function env(e: ModSearchHit["environment"]) {
  return ENVIRONMENT_META[e] ?? ENVIRONMENT_META.unknown;
}
function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
function label(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Release";
}
function date(iso: string): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
}
function shortVersion(v: string | null): string {
  return v ? v.slice(0, 12) : "—";
}
function update(slug: string): boolean {
  return updates.value.has(slug);
}
/** Absent `enabled` means an old wrapper — treat as enabled, same default as before this existed. */
function isDisabled(m: InstalledMod): boolean {
  return m.enabled === false;
}
function iconStyle(hit: ModSearchHit) {
  const c = env(hit.environment).color;
  return { background: hit.iconUrl ? "transparent" : c };
}
function flash(type: "ok" | "err", text: string) {
  toast.add({
    severity: type === "ok" ? "success" : "error",
    summary: type === "ok" ? "Mods" : "Mods — error",
    detail: text,
    life: type === "ok" ? 3500 : 6000,
  });
}
function setBusy(slug: string, on: boolean) {
  const next = new Set(busy.value);
  on ? next.add(slug) : next.delete(slug);
  busy.value = next;
}

async function loadInstalled() {
  loadingInstalled.value = true;
  try {
    installed.value = await mods.fetchInstalled();
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) installed.value = null;
  } finally {
    loadingInstalled.value = false;
  }
}

async function checkNow() {
  checking.value = true;
  try {
    const res = await mods.checkUpdates(true);
    const map = new Map<string, string>();
    for (const r of res.results) {
      if (r.status === "update_available")
        map.set(r.slug, String(r.latestVersionId ?? ""));
    }
    updates.value = map;
  } catch {
    /* leave prior state; a failed check is not fatal */
  } finally {
    checking.value = false;
  }
}

let searchTimer: number | undefined;
function onQueryInput() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(resetSearch, 300);
}

/** A new query or filter starts back at page one. */
function resetSearch() {
  offset.value = 0;
  return runSearch();
}
function nextPage() {
  if (offset.value + PAGE >= total.value) return;
  offset.value += PAGE;
  runSearch();
}
function prevPage() {
  offset.value = Math.max(0, offset.value - PAGE);
  runSearch();
}

async function runSearch() {
  if (!props.activeServer) return;
  searching.value = true;
  openSlug.value = null;
  try {
    const res = await mods.search({
      query: query.value,
      sort: sort.value,
      compatible: compatible.value,
      hideClientOnly: hideClientOnly.value,
      limit: PAGE,
      offset: offset.value,
    });
    results.value = res.hits;
    total.value = res.totalHits;
  } catch (err) {
    flash("err", err instanceof Error ? err.message : "Search failed.");
  } finally {
    searching.value = false;
  }
}

async function toggleVersions(hit: ModSearchHit) {
  if (openSlug.value === hit.slug) {
    openSlug.value = null;
    return;
  }
  openSlug.value = hit.slug;
  detail.value = null;
  loadingDetail.value = true;
  try {
    detail.value = await mods.catalog(hit.slug);
  } catch (err) {
    flash(
      "err",
      err instanceof Error ? err.message : "Could not load versions.",
    );
    openSlug.value = null;
  } finally {
    loadingDetail.value = false;
  }
}

async function runInstall(
  slug: string,
  mcVersion?: string,
  versionId?: string,
) {
  setBusy(slug, true);
  try {
    const r = await mods.install({
      slug,
      ...(mcVersion ? { mcVersion } : {}),
      ...(versionId ? { versionId } : {}),
    });
    if (r.ok) {
      flash(
        "ok",
        `Installed ${r.slug ?? slug}${r.dependencies?.length ? ` (+${r.dependencies.length} deps)` : ""}.`,
      );
      openSlug.value = null;
      await Promise.all([loadInstalled(), checkNow(), runSearch()]);
    } else {
      flash("err", r.error ?? "Install failed.");
    }
  } catch (err) {
    flash("err", err instanceof Error ? err.message : "Install failed.");
  } finally {
    setBusy(slug, false);
  }
}
function installLatest(hit: ModSearchHit) {
  return runInstall(hit.slug);
}
function installVersion(hit: ModSearchHit, v: ModVersion) {
  return runInstall(hit.slug, v.gameVersions[0], v.id);
}
async function updateOne(slug: string) {
  setBusy(slug, true);
  try {
    const r = await mods.updateOne(slug);
    if (r.ok) {
      const n = r.updated?.length ?? 0;
      flash(
        "ok",
        n > 0 ? `Updated ${slug}.` : `${slug} is already up to date.`,
      );
      await Promise.all([loadInstalled(), checkNow()]);
    } else {
      flash("err", r.error ?? "Update failed.");
    }
  } catch (err) {
    flash("err", err instanceof Error ? err.message : "Update failed.");
  } finally {
    setBusy(slug, false);
  }
}

async function doToggle(m: InstalledMod) {
  const disabling = !isDisabled(m);
  setBusy(m.slug, true);
  try {
    const r = disabling
      ? await mods.disable(m.slug)
      : await mods.enable(m.slug);
    if (r.ok) {
      flash(
        "ok",
        `${disabling ? "Disabled" : "Enabled"} ${m.slug}. Restart the server to apply.`,
      );
      await loadInstalled();
    } else {
      flash("err", r.error ?? `${disabling ? "Disable" : "Enable"} failed.`);
    }
  } catch (err) {
    flash(
      "err",
      err instanceof Error
        ? err.message
        : `${disabling ? "Disable" : "Enable"} failed.`,
    );
  } finally {
    setBusy(m.slug, false);
  }
}

async function doRemove(slug: string) {
  if (!window.confirm(`Remove "${slug}" from ${props.activeServer}?`)) return;
  setBusy(slug, true);
  try {
    const r = await mods.remove(slug);
    if (r.ok) {
      flash("ok", `Removed ${slug}.`);
      await Promise.all([loadInstalled(), checkNow(), runSearch()]);
    } else {
      flash("err", r.error ?? "Remove failed.");
    }
  } catch (err) {
    flash("err", err instanceof Error ? err.message : "Remove failed.");
  } finally {
    setBusy(slug, false);
  }
}

async function applyAll() {
  applyingAll.value = true;
  try {
    const r = await mods.applyUpdates();
    if (r.ok) {
      const n = r.updated?.length ?? 0;
      flash(
        "ok",
        n > 0
          ? `Updated ${n} mod${n === 1 ? "" : "s"}.`
          : "Everything already up to date.",
      );
      await Promise.all([loadInstalled(), checkNow()]);
    } else {
      flash("err", r.error ?? "Update failed.");
    }
  } catch (err) {
    flash("err", err instanceof Error ? err.message : "Update failed.");
  } finally {
    applyingAll.value = false;
  }
}

async function reload() {
  if (!props.activeServer) return;
  await loadInstalled();
  await Promise.all([checkNow(), runSearch()]);
  if (installed.value?.compat) await compat.loadVersions();
}

onMounted(reload);
watch(
  () => props.activeServer,
  () => {
    compat.reset();
    openCompat.value = null;
    selectedVersion.value = "";
    return reload();
  },
);
onBeforeUnmount(() => {
  window.clearTimeout(searchTimer);
  compat.dispose();
});
</script>

<style scoped>
.mods {
  --green: var(--mods-green);
  --amber: var(--mods-amber);
  --red: var(--mods-red);
  --muted: var(--mods-muted);
  --muted-2: var(--mods-muted-2);
  --card: var(--mods-card);
  --card-2: var(--mods-card-2);
  --border: rgba(255, 255, 255, 0.07);
  --border-2: rgba(255, 255, 255, 0.11);
  color: var(--mods-text);
}
.mods-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.mods-head h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.mods-head p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13.5px;
}
.mods-head b {
  color: var(--mods-text);
}
.head-actions {
  display: flex;
  gap: 10px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 13px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--border-2);
  background: var(--card-2);
  color: var(--mods-text);
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.green {
  background: var(--green);
  color: var(--mods-on-green);
  border-color: transparent;
  font-weight: 600;
}
.btn .badge {
  background: rgba(5, 19, 10, 0.22);
  border-radius: 20px;
  padding: 0 7px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.msg {
  padding: 9px 13px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 14px;
}
.msg.ok {
  background: rgba(62, 207, 110, 0.14);
  color: var(--green);
}
.msg.err {
  background: rgba(229, 84, 75, 0.13);
  color: var(--red);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.stat {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
}
.stat .n {
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.stat .n.mono {
  font-family: ui-monospace, monospace;
  font-size: 22px;
}
.stat .n.cap {
  text-transform: capitalize;
}
.stat.warn .n {
  color: var(--amber);
}
.stat .l {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 16px;
  align-items: stretch;
}
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.card-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.card-h .t {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 600;
  font-size: 14.5px;
}
.card-h .t i {
  color: var(--green);
}
.card-h .a.muted {
  color: var(--muted);
  font-size: 13px;
}
.empty {
  padding: 22px 20px;
  color: var(--muted-2);
  font-size: 13px;
}
.empty.sm {
  padding: 12px;
}

.browse-top {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.search {
  position: relative;
}
.search i {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  font-size: 14px;
}
.search input {
  width: 100%;
  background: var(--card-2);
  border: 1px solid var(--border-2);
  border-radius: 9px;
  padding: 10px 12px 10px 36px;
  color: var(--mods-text);
  font-size: 13.5px;
  outline: none;
}
.search input:focus {
  border-color: rgba(62, 207, 110, 0.5);
}
.browse-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12.5px;
  cursor: pointer;
}
.toggle input {
  display: none;
}
.sw {
  width: 34px;
  height: 19px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.14);
  position: relative;
  transition: 0.15s;
}
.sw::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--mods-text-2);
  transition: 0.15s;
}
.toggle input:checked + .sw {
  background: var(--green);
}
.toggle input:checked + .sw::after {
  left: 17px;
  background: var(--mods-on-green);
}
.select {
  background: var(--card-2);
  border: 1px solid var(--border-2);
  border-radius: 8px;
  padding: 7px 10px;
  color: var(--muted);
  font-size: 12.5px;
  cursor: pointer;
}

.results {
  padding: 6px 8px;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 60vh;
  overflow-y: auto;
}
.scroll-body {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 75vh;
  overflow-y: auto;
}
.item.open {
  background: rgba(255, 255, 255, 0.02);
  border-radius: 10px;
}
.result {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
}
.ricon {
  width: 42px;
  height: 42px;
  border-radius: 9px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 16px;
  color: var(--mods-on-green);
  overflow: hidden;
}
.ricon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.info {
  min-width: 0;
  flex: 1;
}
.rt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rt a {
  color: var(--mods-text);
}
.rt b {
  font-size: 13.5px;
}
.rt .by {
  color: var(--muted-2);
  font-size: 11.5px;
}
.rd {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 340px;
}
.meta {
  display: flex;
  gap: 10px;
  margin-top: 7px;
  color: var(--muted-2);
  font-size: 11.5px;
  align-items: center;
}
.meta .dl {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.env {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  color: var(--muted);
}
.env .d {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.extlink {
  color: var(--muted-2);
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  flex: 0 0 26px;
}
.extlink:hover {
  color: var(--mods-text);
  background: rgba(255, 255, 255, 0.05);
}
.add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  background: var(--green);
  color: var(--mods-on-green);
  border: none;
  white-space: nowrap;
}
.add:disabled {
  opacity: 0.6;
}
.add.installed {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border-2);
  cursor: default;
  font-weight: 500;
}

.picker {
  margin: 0 12px 12px 66px;
  background: var(--card-2);
  border: 1px solid var(--border-2);
  border-radius: 10px;
  overflow: hidden;
}
.picker-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}
.picker-h .lbl {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--muted-2);
  font-weight: 600;
}
.vrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.vrow:last-child {
  border-bottom: 0;
}
.vv {
  font-family: ui-monospace, monospace;
  font-size: 12.5px;
  min-width: 64px;
}
.gt {
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 7px;
  border-radius: 20px;
}
.ty {
  font-size: 11px;
  color: var(--muted);
}
.ty.beta {
  color: var(--amber);
}
.dt {
  margin-left: auto;
  color: var(--muted-2);
  font-size: 11.5px;
}
.install {
  padding: 5px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  background: var(--green);
  color: var(--mods-on-green);
  border: none;
  cursor: pointer;
}
.install.ghost {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border-2);
}
.install.sm {
  padding: 4px 10px;
  font-size: 11.5px;
}
.install:disabled {
  opacity: 0.6;
}

table {
  width: 100%;
  border-collapse: collapse;
}
thead th {
  text-align: left;
  color: var(--muted-2);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  font-weight: 600;
  padding: 11px 20px;
  border-bottom: 1px solid var(--border);
}
tbody td {
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}
tbody tr:last-child td {
  border-bottom: 0;
}
.mod-name {
  font-weight: 550;
  font-size: 13.5px;
}
.mod-file {
  color: var(--muted-2);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  margin-top: 2px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ver {
  font-family: ui-monospace, monospace;
  font-size: 12.5px;
  color: var(--mods-text-3);
}
.pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 20px;
  font-size: 11.5px;
  font-weight: 500;
}
.pill.ok {
  background: rgba(62, 207, 110, 0.14);
  color: var(--green);
}
.pill.up {
  background: rgba(229, 161, 58, 0.14);
  color: var(--amber);
}
.pill.off {
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
  cursor: help;
}
.row-disabled {
  opacity: 0.6;
}
.row-actions {
  display: flex;
  gap: 7px;
  justify-content: flex-end;
  align-items: center;
}
.mini {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--mods-text);
}
.mini.update {
  background: var(--amber);
  color: var(--mods-on-amber);
  border-color: transparent;
  font-weight: 600;
}
.mini.toggle {
  color: var(--muted);
}
.mini.remove {
  color: var(--muted);
  padding: 6px 9px;
}
.mini.remove:hover {
  color: var(--red);
  border-color: rgba(229, 84, 75, 0.13);
  background: rgba(229, 84, 75, 0.13);
}
.mini:disabled {
  opacity: 0.5;
}
.foot {
  padding: 10px 20px;
  border-top: 1px solid var(--border);
  color: var(--muted-2);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pager {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.pg {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.pg:hover:not(:disabled) {
  color: var(--mods-text);
  border-color: rgba(255, 255, 255, 0.2);
}
.pg:disabled {
  opacity: 0.4;
  cursor: default;
}
.pg-info {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.compat {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 20px;
  margin-bottom: 16px;
}
.compat-h {
  font-weight: 600;
  font-size: 13.5px;
  margin-bottom: 10px;
}
.compat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.compat-input {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-2);
  background: var(--card-2);
  color: var(--mods-text);
  font-size: 13px;
  width: 140px;
}
.linkbtn {
  background: transparent;
  border: 0;
  color: var(--muted);
  font-size: 12.5px;
  cursor: pointer;
  text-decoration: underline;
}
.linkbtn:disabled {
  opacity: 0.5;
  cursor: default;
}
.msg.stale {
  background: rgba(229, 161, 58, 0.13);
  color: var(--amber);
  margin: 10px 0 0;
}
.compat .msg.err {
  margin: 10px 0 0;
}
.compat-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12.5px;
}
.chip {
  padding: 3px 11px;
  border-radius: 20px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.chip.on {
  color: var(--mods-text);
  background: rgba(255, 255, 255, 0.09);
}
.compat .muted,
td .muted {
  color: var(--muted);
}
td .small {
  font-size: 12px;
}
.compat-stat {
  grid-column: 1 / -1;
}
.stat .n.sm {
  font-size: 20px;
}
.compat-badge {
  border: 0;
  cursor: pointer;
}
.compat-badge.c-available {
  background: rgba(62, 207, 110, 0.14);
  color: var(--green);
}
.compat-badge.c-unavailable {
  background: rgba(229, 84, 75, 0.13);
  color: var(--red);
}
.compat-badge.c-unknown {
  background: rgba(229, 161, 58, 0.14);
  color: var(--amber);
}
.compat-detail td {
  padding: 8px 20px 12px;
  color: var(--muted);
  font-size: 12.5px;
  background: rgba(255, 255, 255, 0.02);
}
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
