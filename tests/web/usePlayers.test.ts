// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("../../src/web/frontend/src/api", async (importActual) => ({
  ...(await importActual<typeof import("../../src/web/frontend/src/api")>()),
  apiGet,
}));

import { ApiError } from "../../src/web/frontend/src/api";
import {
  usePlayers,
  playerListUrl,
  playerHeadUrl,
  orderParam,
  PLAYER_PAGE,
} from "../../src/web/frontend/src/composables/usePlayers.js";

const LIST = { players: [], total: 45, rangeHours: 336, historyDays: 365, limit: 20, offset: 0 };

beforeEach(() => {
  apiGet.mockReset();
});

describe("playerListUrl", () => {
  const base = {
    q: "",
    status: "all" as const,
    quietDays: 14,
    hours: 336,
    sort: "playtimeMs" as const,
    order: -1 as const,
    page: 1,
  };

  it("sends the filters, the order as a word and the offset for the page", () => {
    const url = playerListUrl("smp", { ...base, page: 3, order: 1, sort: "name" });
    expect(url).toBe(
      `/api/servers/smp/players?status=all&hours=336&quietDays=14&sort=name&order=asc&limit=${PLAYER_PAGE}&offset=${2 * PLAYER_PAGE}`,
    );
  });

  it("includes a trimmed search and encodes ids", () => {
    const url = playerListUrl("my server", { ...base, q: "  ste " });
    expect(url).toContain("/api/servers/my%20server/players?");
    expect(url).toContain("q=ste");
  });

  it("maps the sort control's numbers", () => {
    expect(orderParam(1)).toBe("asc");
    expect(orderParam(-1)).toBe("desc");
  });

  it("builds the head url from the encoded name", () => {
    expect(playerHeadUrl("smp", "a b")).toBe("/api/servers/smp/players/a%20b/head");
  });
});

describe("usePlayers list", () => {
  it("loads the list and counts pages", async () => {
    apiGet.mockResolvedValue(LIST);
    const p = usePlayers();
    await p.loadList("smp");
    expect(p.list.value).toEqual(LIST);
    expect(p.totalPages.value).toBe(3);
    expect(p.listLoaded.value).toBe(true);
    expect(p.listLoading.value).toBe(false);
  });

  it("goes back to the first page when a filter changes", async () => {
    apiGet.mockResolvedValue(LIST);
    const p = usePlayers();
    await p.loadList("smp");
    p.goToPage("smp", 2);
    expect(p.page.value).toBe(2);
    p.status.value = "online";
    await p.refilter("smp");
    expect(p.page.value).toBe(1);
    expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining("status=online"));
    expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining("offset=0"));
  });

  it("ignores a page outside the range", async () => {
    apiGet.mockResolvedValue(LIST);
    const p = usePlayers();
    await p.loadList("smp");
    p.goToPage("smp", 9);
    p.goToPage("smp", 0);
    expect(p.page.value).toBe(1);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest answer when an older request lands last", async () => {
    let finishOld!: (v: unknown) => void;
    apiGet.mockImplementationOnce(() => new Promise((r) => (finishOld = r)));
    apiGet.mockResolvedValueOnce({ ...LIST, total: 1 });
    const p = usePlayers();
    const old = p.loadList("smp");
    await p.loadList("smp");
    finishOld({ ...LIST, total: 99 });
    await old;
    expect(p.list.value?.total).toBe(1);
  });

  it("records a failure with its kind and clears the list", async () => {
    apiGet.mockRejectedValue(new ApiError(502, "wrapper gone"));
    const p = usePlayers();
    await p.loadList("smp");
    expect(p.list.value).toBeNull();
    expect(p.listFailure.value).toEqual({ error: "wrapper gone", kind: "unreachable" });
    expect(p.listLoading.value).toBe(false);
  });

  it("debounces typing into one request", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(LIST);
    const p = usePlayers();
    p.q.value = "s";
    p.onQueryInput("smp");
    p.q.value = "st";
    p.onQueryInput("smp");
    expect(apiGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining("q=st"));
    vi.useRealTimers();
  });
});

describe("usePlayers detail", () => {
  it("loads one player by encoded name", async () => {
    apiGet.mockResolvedValue({ name: "Steve" });
    const p = usePlayers();
    await p.loadDetail("smp", "Steve");
    expect(apiGet).toHaveBeenCalledWith("/api/servers/smp/players/Steve");
    expect(p.detail.value).toEqual({ name: "Steve" });
  });

  it("marks a 404 as not found, not as an outage", async () => {
    apiGet.mockRejectedValue(new ApiError(404, "unknown"));
    const p = usePlayers();
    await p.loadDetail("smp", "Ghost");
    expect(p.detailFailure.value).toMatchObject({ notFound: true, kind: "failed" });
    expect(p.detail.value).toBeNull();
  });

  it("closing drops the player and ignores a request still in flight", async () => {
    let finish!: (v: unknown) => void;
    apiGet.mockImplementation(() => new Promise((r) => (finish = r)));
    const p = usePlayers();
    const pending = p.loadDetail("smp", "Steve");
    p.closeDetail();
    finish({ name: "Steve" });
    await pending;
    expect(p.detail.value).toBeNull();
    expect(p.detailLoading.value).toBe(false);
  });

  it("reset forgets the list and the player", async () => {
    apiGet.mockResolvedValue(LIST);
    const p = usePlayers();
    await p.loadList("smp");
    p.page.value = 3;
    p.reset();
    expect(p.list.value).toBeNull();
    expect(p.listLoaded.value).toBe(false);
    expect(p.page.value).toBe(1);
  });
});
