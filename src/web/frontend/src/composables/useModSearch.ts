import { computed, onBeforeUnmount, ref } from "vue";
import type { ModProjectDetail, ModSearchHit } from "../api";
import { apiErrorText } from "../utils/errorMessage";
import type { useMods } from "./useMods";

export const CATALOG_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The Modrinth catalogue panel's state: the query and filters, the current
 * page of hits, and the version picker opened under one hit. A late answer to
 * an older search never replaces a newer one.
 */
export function useModSearch(mods: ReturnType<typeof useMods>, server: () => string) {
  const query = ref("");
  const sort = ref("relevance");
  const compatible = ref(true);
  const hideClientOnly = ref(true);
  const results = ref<ModSearchHit[]>([]);
  const total = ref(0);
  const searching = ref(false);
  const searchError = ref("");
  /** False until the first search for this server answered, so nothing reads as "no results" early. */
  const searched = ref(false);
  const offset = ref(0);
  const page = computed(() => Math.floor(offset.value / CATALOG_PAGE) + 1);
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / CATALOG_PAGE)));

  const openSlug = ref<string | null>(null);
  const detail = ref<ModProjectDetail | null>(null);
  const loadingDetail = ref(false);
  const detailError = ref("");

  let searchTimer: number | undefined;
  let searchSeq = 0;

  async function runSearch(): Promise<void> {
    if (!server()) return;
    const mine = ++searchSeq;
    searching.value = true;
    openSlug.value = null;
    try {
      const res = await mods.search({
        query: query.value,
        sort: sort.value,
        compatible: compatible.value,
        hideClientOnly: hideClientOnly.value,
        limit: CATALOG_PAGE,
        offset: offset.value,
      });
      if (mine !== searchSeq) return;
      results.value = res.hits;
      total.value = res.totalHits;
      searchError.value = "";
    } catch (err) {
      if (mine !== searchSeq) return;
      results.value = [];
      total.value = 0;
      searchError.value = apiErrorText(err, "no response");
    } finally {
      if (mine === searchSeq) {
        searching.value = false;
        searched.value = true;
      }
    }
  }

  function resetSearch(): Promise<void> {
    offset.value = 0;
    return runSearch();
  }

  function onQueryInput(): void {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void resetSearch(), SEARCH_DEBOUNCE_MS);
  }

  function toggleCompatible(): void {
    compatible.value = !compatible.value;
    void resetSearch();
  }

  function toggleClientOnly(): void {
    hideClientOnly.value = !hideClientOnly.value;
    void resetSearch();
  }

  function goToPage(n: number): void {
    if (n === page.value || n < 1 || n > totalPages.value) return;
    offset.value = (n - 1) * CATALOG_PAGE;
    void runSearch();
  }

  async function loadDetail(hit: ModSearchHit): Promise<void> {
    detail.value = null;
    detailError.value = "";
    loadingDetail.value = true;
    try {
      const next = await mods.catalog(hit.slug);
      if (openSlug.value === hit.slug) detail.value = next;
    } catch (err) {
      if (openSlug.value === hit.slug) detailError.value = apiErrorText(err, "no response");
    } finally {
      loadingDetail.value = false;
    }
  }

  function toggleVersions(hit: ModSearchHit): void {
    if (openSlug.value === hit.slug) {
      openSlug.value = null;
      return;
    }
    openSlug.value = hit.slug;
    void loadDetail(hit);
  }

  /** A server switch: forget the old server's hits. */
  function reset(): void {
    openSlug.value = null;
    searched.value = false;
    results.value = [];
  }

  onBeforeUnmount(() => window.clearTimeout(searchTimer));

  return {
    query, sort, compatible, hideClientOnly,
    results, total, searching, searchError, searched,
    page, totalPages,
    openSlug, detail, loadingDetail, detailError,
    runSearch, resetSearch, onQueryInput, toggleCompatible, toggleClientOnly, goToPage,
    loadDetail, toggleVersions, reset,
  };
}
