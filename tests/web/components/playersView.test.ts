// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import PlayersView from "../../../src/web/frontend/src/views/PlayersView.vue";
import { uiGlobal, settle } from "./mountUi";

// PrimeVue Select listens for orientation changes; jsdom has no matchMedia.
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

type Route = (url: string) => { status?: number; body: unknown } | undefined;

let wrapper: VueWrapper | null = null;
let calls: string[] = [];

function install(route: Route): void {
  calls = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    calls.push(url);
    const hit = route(url) ?? { status: 500, body: { error: "unexpected" } };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function mountView(props: Record<string, unknown> = {}) {
  wrapper = mount(PlayersView, {
    attachTo: document.body,
    global: uiGlobal,
    props: { serverIds: ["smp"], activeServer: "smp", player: "", ...props },
  });
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

const ROW = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  online: false,
  lastSeen: Date.now() - 3_600_000,
  firstSeen: Date.now() - 86_400_000,
  sessions: 4,
  playtimeMs: 7_200_000,
  ...over,
});

const ACTIVITY = {
  online: false,
  firstSeen: Date.now() - 86_400_000,
  lastSeen: Date.now() - 3_600_000,
  sessions: 4,
  playtimeMs: 7_200_000,
  longestSessionMs: 3_600_000,
  recentSessions: [{ joinedAt: Date.now() - 7_200_000, leftAt: Date.now() - 3_600_000 }],
  daily: [{ day: Date.UTC(2026, 9, 18), playtimeMs: 3_600_000 }],
  historyDays: 365,
};

describe("PlayersView list", () => {
  it("lists players and opens one through update-route", async () => {
    install((url) => {
      if (url.startsWith("/api/servers/smp/players?")) {
        return {
          body: {
            players: [ROW("Steve"), ROW("Alex", { online: true })],
            total: 2,
            rangeHours: 336,
            historyDays: 365,
            limit: 20,
            offset: 0,
          },
        };
      }
      return undefined;
    });
    const w = mountView();
    await settle(40);

    expect(w.text()).toContain("Steve");
    expect(w.text()).toContain("2 matching");
    expect(w.text()).toContain("kept for 365 days");

    const open = w.findAll("button.link-btn").find((b) => b.text().includes("Steve"))!;
    await open.trigger("click");
    expect(w.emitted("update-route")?.[0]).toEqual([{ params: { player: "Steve" } }]);
  });

  it("says why the list is empty for the chosen filter", async () => {
    install(() => ({
      body: { players: [], total: 0, rangeHours: 336, historyDays: 365, limit: 20, offset: 0 },
    }));
    const w = mountView();
    await settle(40);
    expect(w.text()).toContain("Nobody has a recorded session in the last 14d.");
  });

  it("shows an error with a retry when the list fails", async () => {
    install(() => ({ status: 502, body: { error: "db gone" } }));
    const w = mountView();
    await settle(40);
    expect(w.text()).toContain("The player list did not load");
  });
});

describe("PlayersView detail", () => {
  it("hides account and moderation details when the viewer lacks access", async () => {
    install((url) => {
      if (url === "/api/servers/smp/players/Steve") {
        return {
          body: {
            serverId: "smp",
            name: "Steve",
            uuid: null,
            activity: ACTIVITY,
            stats: [{ key: "deaths", label: "Deaths", value: 3, formatted: "3" }],
            sensitiveAccess: false,
            sensitive: null,
          },
        };
      }
      return undefined;
    });
    const w = mountView({ player: "Steve" });
    await settle(40);

    expect(w.text()).toContain("Steve");
    expect(w.text()).toContain("Deaths");
    expect(w.text()).toContain("Account and moderation details are hidden");
    expect(w.text()).not.toContain("Moderation");
  });

  it("shows the sensitive sections when the viewer has access", async () => {
    install(() => ({
      body: {
        serverId: "smp",
        name: "Steve",
        uuid: "069a79f444e94726a5befca90e38aaf5",
        activity: ACTIVITY,
        stats: null,
        sensitiveAccess: true,
        sensitive: {
          link: { discordId: "123", displayName: "SteveD" },
          whitelist: { addedBy: "Admin#1", addedAt: "2026-01-01", removedBy: null, removedAt: null, server: "smp" },
          notes: [{ text: "watch the farm", author: "Mod#1", createdAt: "2026-02-01" }],
          applications: [],
          tempBan: { expiresAt: Date.now() + 3_600_000, bannedAt: Date.now(), by: "Mod#1", reason: "grief" },
          streak: { current: 4, longest: 9, lastClaim: 1 },
        },
      },
    }));
    const w = mountView({ player: "Steve" });
    await settle(40);

    expect(w.text()).toContain("SteveD");
    expect(w.text()).toContain("Added by Admin#1 on 2026-01-01.");
    expect(w.text()).toContain("watch the farm");
    expect(w.text()).toContain("grief");
    expect(w.text()).toContain("Daily streak: 4 now, 9 best.");
    expect(w.text()).toContain("Stats could not be read");
  });

  it("explains a player nothing is known about", async () => {
    install(() => ({ status: 404, body: { error: "nope" } }));
    const w = mountView({ player: "Ghost" });
    await settle(40);
    expect(w.text()).toContain("Nothing is known about Ghost");
  });

  it("goes back to the list", async () => {
    install(() => ({ status: 404, body: { error: "nope" } }));
    const w = mountView({ player: "Ghost" });
    await settle(40);
    await w.findAll("button").find((b) => b.text().includes("All players"))!.trigger("click");
    expect(w.emitted("update-route")?.[0]).toEqual([{ params: { player: undefined } }]);
  });
});
