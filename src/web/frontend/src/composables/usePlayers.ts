import { computed, onBeforeUnmount, ref } from "vue";
import type {
  PlayerDetail,
  PlayerListResponse,
  PlayerSortField,
  PlayerStatusFilter,
} from "@mcbot/schema";
import { ApiError, apiGet } from "../api";
import { errorMessage } from "../utils/errorMessage";
import { loadFailure, type LoadFailure } from "../utils/loadFailure";
import { latest } from "./useLoader";

export const PLAYER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** The window choices for the playtime and session columns, in hours. */
export const PLAYER_RANGE_HOURS = [24, 7 * 24, 14 * 24, 30 * 24, 90 * 24, 365 * 24] as const;
export const QUIET_DAY_CHOICES = [7, 14, 30, 60, 90] as const;

/** `sort-control` speaks 1 and -1; the API speaks asc and desc. */
export function orderParam(order: 1 | -1): "asc" | "desc" {
  return order === 1 ? "asc" : "desc";
}

export function playerListUrl(
  serverId: string,
  opts: {
    q: string;
    status: PlayerStatusFilter;
    quietDays: number;
    hours: number;
    sort: PlayerSortField;
    order: 1 | -1;
    page: number;
  },
): string {
  const params = new URLSearchParams({
    status: opts.status,
    hours: String(opts.hours),
    quietDays: String(opts.quietDays),
    sort: opts.sort,
    order: orderParam(opts.order),
    limit: String(PLAYER_PAGE),
    offset: String((opts.page - 1) * PLAYER_PAGE),
  });
  const q = opts.q.trim();
  if (q) params.set("q", q);
  return `/api/servers/${encodeURIComponent(serverId)}/players?${params}`;
}

export function playerHeadUrl(serverId: string, name: string): string {
  return `/api/servers/${encodeURIComponent(serverId)}/players/${encodeURIComponent(name)}/head`;
}

/**
 * The Players page's state: the searchable list and the one open player. A
 * late answer to an older search or an older player never replaces a newer one.
 */
export function usePlayers() {
  const q = ref("");
  const status = ref<PlayerStatusFilter>("all");
  const quietDays = ref(14);
  const hours = ref<number>(14 * 24);
  const sort = ref<PlayerSortField>("playtimeMs");
  const order = ref<1 | -1>(-1);
  const page = ref(1);

  const list = ref<PlayerListResponse | null>(null);
  const listLoading = ref(false);
  const listLoaded = ref(false);
  const listFailure = ref<{ error: string; kind: LoadFailure } | null>(null);

  const detail = ref<PlayerDetail | null>(null);
  const detailLoading = ref(false);
  const detailFailure = ref<{ error: string; kind: LoadFailure; notFound: boolean } | null>(null);

  const totalPages = computed(() =>
    Math.max(1, Math.ceil((list.value?.total ?? 0) / PLAYER_PAGE)),
  );

  const listLoads = latest();
  const detailLoads = latest();
  let searchTimer: number | undefined;

  async function loadList(serverId: string): Promise<void> {
    if (!serverId) return;
    const isCurrent = listLoads.begin();
    listLoading.value = true;
    try {
      const res = await apiGet<PlayerListResponse>(
        playerListUrl(serverId, {
          q: q.value,
          status: status.value,
          quietDays: quietDays.value,
          hours: hours.value,
          sort: sort.value,
          order: order.value,
          page: page.value,
        }),
      );
      if (!isCurrent()) return;
      list.value = res;
      listFailure.value = null;
    } catch (err) {
      if (!isCurrent()) return;
      list.value = null;
      listFailure.value = { error: errorMessage(err), kind: loadFailure(err) };
    } finally {
      if (isCurrent()) {
        listLoading.value = false;
        listLoaded.value = true;
      }
    }
  }

  /** Each status filter has the order that answers its question. */
  function applyStatusSort(): void {
    if (status.value === "quiet") {
      sort.value = "lastSeen";
      order.value = -1;
    } else if (status.value === "new") {
      sort.value = "firstSeen";
      order.value = -1;
    } else {
      sort.value = "playtimeMs";
      order.value = -1;
    }
  }

  /** A filter or sort changed: back to the first page. */
  function refilter(serverId: string): Promise<void> {
    page.value = 1;
    return loadList(serverId);
  }

  function onQueryInput(serverId: string): void {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void refilter(serverId), SEARCH_DEBOUNCE_MS);
  }

  function goToPage(serverId: string, n: number): void {
    if (n === page.value || n < 1 || n > totalPages.value) return;
    page.value = n;
    void loadList(serverId);
  }

  async function loadDetail(serverId: string, name: string): Promise<void> {
    if (!serverId || !name) return;
    const isCurrent = detailLoads.begin();
    detailLoading.value = true;
    detailFailure.value = null;
    try {
      const res = await apiGet<PlayerDetail>(
        `/api/servers/${encodeURIComponent(serverId)}/players/${encodeURIComponent(name)}`,
      );
      if (!isCurrent()) return;
      detail.value = res;
    } catch (err) {
      if (!isCurrent()) return;
      detail.value = null;
      const message = errorMessage(err);
      const kind = loadFailure(err);
      detailFailure.value = {
        error: message,
        kind,
        notFound: err instanceof ApiError && err.status === 404,
      };
    } finally {
      if (isCurrent()) detailLoading.value = false;
    }
  }

  function closeDetail(): void {
    detailLoads.cancel();
    detail.value = null;
    detailFailure.value = null;
    detailLoading.value = false;
  }

  /** A server switch: forget the old server's list and player. */
  function reset(): void {
    listLoads.cancel();
    list.value = null;
    listLoaded.value = false;
    listFailure.value = null;
    page.value = 1;
    closeDetail();
  }

  onBeforeUnmount(() => window.clearTimeout(searchTimer));

  return {
    q, status, quietDays, hours, sort, order, page, totalPages,
    list, listLoading, listLoaded, listFailure,
    detail, detailLoading, detailFailure,
    loadList, refilter, applyStatusSort, onQueryInput, goToPage, loadDetail, closeDetail, reset,
  };
}
