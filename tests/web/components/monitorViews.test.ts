// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, type Component } from "vue";
import StatusView from "../../../src/web/frontend/src/views/StatusView.vue";
import AuditView from "../../../src/web/frontend/src/views/AuditView.vue";
import AnalyticsView from "../../../src/web/frontend/src/views/AnalyticsView.vue";
import TypedConfirmDialog from "../../../src/web/frontend/src/components/ui/TypedConfirmDialog.vue";
import { setCapabilities } from "../../../src/web/frontend/src/composables/useCapabilities";
import { uiGlobal, settle } from "./mountUi";

type Route = (method: string, url: string) => { status?: number; body: unknown } | undefined;

let calls: Array<{ method: string; url: string }> = [];
let wrapper: VueWrapper | null = null;

function install(route: Route): void {
  calls = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const hit = route(method, url) ?? { status: 500, body: { error: "unexpected" } };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function mountWith(view: Component, props: Record<string, unknown> = {}) {
  const Host = defineComponent({
    setup() {
      return () => h("div", [h(view, props), h(TypedConfirmDialog)]);
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: uiGlobal });
  return wrapper;
}

function button(text: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

const STATUS = {
  bot: { alive: true, lastBeat: null, startedAt: null, version: null },
  servers: [
    {
      id: "smp",
      state: "online",
      wrapper: "reachable",
      tps: 19.6,
      players: { online: 3, max: 20, names: ["Steve", "Alex", "Notch"], sampled: false },
      features: { scripts: { start: true, stop: true, restart: true, rollback: true, backup: true } },
    },
  ],
};

beforeEach(() => {
  setCapabilities({ "*": ["server:read", "server:control", "audit:read"] });
  // jsdom has no matchMedia; PrimeVue's Select (paginator, stat picker) asks for one on mount.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("StatusView", () => {
  function servers(action?: { status?: number; body: unknown }): void {
    install((method, url) => {
      if (url === "/api/status") return { body: STATUS };
      if (url.endsWith("/pending-actions")) return { body: { intents: [] } };
      if (method === "POST" && action) return action;
      return undefined;
    });
  }

  it("states the player count in the restart confirm and keeps a failed run on the card", async () => {
    servers({ body: { ok: false, exitCode: 2, output: "", stderr: "restart.sh: not found" } });
    const w = mountWith(StatusView, { activeServer: "smp" });
    await settle();
    expect(w.find("h1").text()).toBe("Servers");
    expect(w.find(".card .status-chip").text()).toBe("Online");
    button("Restart").click();
    await settle(60);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Restart smp?");
    expect(dialog.textContent).toContain("3 players are online");
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");
    button("Restart smp", dialog).click();
    await settle(60);
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/servers/smp/restart")).toBe(true);
    const job = w.find(".job-block");
    expect(job.text()).toContain("Restarting smp failed");
    expect(job.text()).toContain("Exit code 2");
    expect(job.find("pre").text()).toBe("restart.sh: not found");
    await job.findAll("button").find((b) => b.text() === "Dismiss")!.trigger("click");
    expect(w.find(".job-block").exists()).toBe(false);
  });

  it("offers Roll back only with server:rollback", async () => {
    servers();
    mountWith(StatusView, { activeServer: "smp" });
    await settle();
    expect(button("Restart")).toBeTruthy();
    expect(() => button("Roll back")).toThrow();
  });

  it("asks for the server name before a rollback", async () => {
    setCapabilities({ "*": ["server:read", "server:control", "server:rollback"] });
    servers();
    mountWith(StatusView, { activeServer: "smp" });
    await settle();
    button("Roll back").click();
    await settle(60);
    expect(document.activeElement?.id).toBe("typed-confirm");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("There is no undo.");
    expect(button("Roll back smp", dialog).disabled).toBe(true);
  });

  it("explains a refused status read instead of showing an empty list", async () => {
    install((_m, url) => (url === "/api/status" ? { status: 403, body: { error: "forbidden" } } : undefined));
    const w = mountWith(StatusView);
    await settle();
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain("You cannot see server status");
    expect(alert.text()).toContain("server:read");
    expect(alert.findAll("button")).toHaveLength(0);
    expect(w.text()).not.toContain("No servers configured yet");
  });
});

describe("AuditView", () => {
  it("tells a failed load apart from an empty log and hides history the reader may not see", async () => {
    install((_m, url) => {
      if (url.startsWith("/api/audit")) return { status: 500, body: { error: "db locked" } };
      if (url === "/api/config/history") return { status: 403, body: { error: "forbidden" } };
      if (url === "/api/setup/guilds") return { body: { guilds: [] } };
      return undefined;
    });
    const w = mountWith(AuditView);
    await settle();
    expect(w.find("h1").text()).toBe("Audit log");
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain("The audit log did not load");
    expect(alert.text()).toContain("GET /api/audit: db locked");
    expect(w.text()).not.toContain("No admin action recorded yet");
    expect(w.text()).not.toContain("Config history");
  });

  it("says when the log is empty and labels its filter", async () => {
    install((_m, url) => {
      if (url.startsWith("/api/audit")) {
        return { body: { entries: [{ at: "2026-10-11 10:00:00", action: "restart (dashboard)", server: "smp", by: "domenic", detail: null }] } };
      }
      if (url === "/api/config/history") return { body: { retentionDays: 3, entries: [] } };
      if (url === "/api/setup/guilds") return { body: { guilds: [] } };
      return undefined;
    });
    const w = mountWith(AuditView);
    await settle();
    expect(w.text()).toContain("No config change in the last 3 days.");
    expect(document.querySelector('label[for="audit-filter"]')?.textContent).toBe("Filter the audit log");
    await w.find("#audit-filter").setValue("nothing-like-this");
    expect(w.text()).toContain('No entry matches "nothing-like-this"');
  });
});

describe("AnalyticsView", () => {
  const caps = { activity: 2160, uptime: 720, leaderboard: 768, commands: 2160, sessions: 8760 };
  const none = { total: 0, online: 0 };
  const now = Date.now();

  function routeAnalytics(extra: Route = () => undefined): Route {
    return (method, url) => {
      const hit = extra(method, url);
      if (hit) return hit;
      if (url.startsWith("/api/servers/smp/analytics/leaderboard")) {
        return {
          body: {
            stat: "playtime",
            title: "Playtime",
            entries: [{ name: "Steve", value: 20 * 3600 * 12, formatted: "0d 12h 0m 0s" }],
            stale: null,
            available: [{ key: "playtime", label: "Playtime" }],
            rangeHours: 336,
            baselineAt: null,
            historyShorterThanRange: false,
            caps,
          },
        };
      }
      if (url.startsWith("/api/servers/smp/players?")) {
        return {
          body: {
            players: [
              { name: "Alex", online: false, lastSeen: now - 3_600_000, firstSeen: now - 86_400_000, sessions: 2, playtimeMs: 3_600_000 },
            ],
            total: 1,
            rangeHours: 336,
            historyDays: 365,
            limit: 20,
            offset: 0,
          },
        };
      }
      if (url.startsWith("/api/analytics/commands")) return { status: 502, body: { error: "db gone" } };
      if (url.startsWith("/api/servers/smp/analytics")) {
        return {
          body: {
            uptime: {
              pct24h: null, pct7d: null, pct30d: null,
              checks24h: none, checks7d: none, checks30d: none,
              currentState: "unknown", currentStateDuration: 0, sparkline24h: "",
              range: { rangeHours: 336, pct: null, checks: none },
            },
            activity: {
              rangeHours: 336,
              hours: [{ at: now - 7_200_000, avg: 2, peak: 5, samples: 3 }],
              busiest: [],
            },
            caps,
          },
        };
      }
      return undefined;
    };
  }

  it("opens on the Players tab: activity with its coverage, the board and the player list", async () => {
    install(routeAnalytics());
    const w = mountWith(AnalyticsView, { serverIds: ["smp"], activeServer: "smp" });
    await settle(80);

    expect(w.find(".b-value").text()).toBe("12 h");
    expect(w.text()).not.toContain("0d 12h 0m 0s");
    expect(w.text()).toContain("Players online");
    expect(w.text()).toContain("last 14d");
    expect(w.findAll(".bar-peak")).toHaveLength(1);
    expect(w.text()).toContain("Alex");
    expect(w.find("#an-uptime-h").exists()).toBe(false);
    expect(w.find("#an-commands-h").exists()).toBe(false);
  });

  it("opens a player from the leaderboard and from the player list", async () => {
    install(routeAnalytics());
    const w = mountWith(AnalyticsView, { serverIds: ["smp"], activeServer: "smp" });
    await settle(80);

    await w.find(".b-name").trigger("click");
    const view = w.findComponent(AnalyticsView);
    expect(view.emitted("open-player")?.[0]).toEqual(["Steve"]);

    const alex = w.findAll("button.link-btn").find((b) => b.text().includes("Alex"))!;
    await alex.trigger("click");
    expect(view.emitted("open-player")?.[1]).toEqual(["Alex"]);
  });

  it("asks the route to switch tabs", async () => {
    install(routeAnalytics());
    const w = mountWith(AnalyticsView, { serverIds: ["smp"], activeServer: "smp" });
    await settle(80);
    await w.find("#an-tab-server").trigger("click");
    expect(w.findComponent(AnalyticsView).emitted("update-route")?.[0]).toEqual([{ params: { tab: "server" } }]);
  });

  it("shows uptime and command usage on the Server tab, explaining an uptime with no checks", async () => {
    install(routeAnalytics());
    const w = mountWith(AnalyticsView, { serverIds: ["smp"], activeServer: "smp", tab: "server" });
    await settle(80);

    expect(w.text()).toContain("No health checks are recorded for smp yet.");
    expect(w.findAll(".u-pct")).toHaveLength(0);
    expect(w.text()).toContain("Command usage did not load");
    expect(w.text()).not.toContain("No command was used");
    expect(w.find("#an-board-h").exists()).toBe(false);
    expect(w.find("#an-activity-h").exists()).toBe(false);
  });

  it("draws one bar per day when the range is longer than two weeks", async () => {
    const hours = Array.from({ length: 72 }, (_, i) => ({
      at: Date.UTC(2026, 9, 1) + i * 3_600_000,
      avg: 1,
      peak: 2,
      samples: 1,
    }));
    install(
      routeAnalytics((_m, url) =>
        url.startsWith("/api/servers/smp/analytics?")
          ? { body: { uptime: null, activity: { rangeHours: 24 * 90, hours, busiest: [] }, caps } }
          : undefined,
      ),
    );
    const w = mountWith(AnalyticsView, { serverIds: ["smp"], activeServer: "smp" });
    await settle(80);
    expect(w.findAll(".bar")).toHaveLength(3);
    expect(w.text()).toContain("One bar per day");
  });
});
