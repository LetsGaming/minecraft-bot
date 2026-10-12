// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import ModsView from "../../../src/web/frontend/src/views/ModsView.vue";
import TypedConfirmDialog from "../../../src/web/frontend/src/components/ui/TypedConfirmDialog.vue";
import { setCapabilities } from "../../../src/web/frontend/src/composables/useCapabilities";
import { uiGlobal, settle } from "./mountUi";

const ICON = "/api/servers/smp/mods/icon?url=https%3A%2F%2Fcdn.modrinth.com%2Fdata%2Fsodium%2Ficon.png";

const INSTALLED = {
  gameVersion: "1.21.4",
  modLoader: "fabric",
  mtimeMs: 1,
  stale: null,
  compat: true,
  mods: [
    { slug: "sodium", filename: "sodium-fabric-0.6.13.jar", versionId: "AbC12345", enabled: true, iconUrl: ICON },
    { slug: "lithium", filename: "lithium-fabric-0.14.3.jar", versionId: "XyZ98765", enabled: true },
    { slug: "terralith", filename: "Terralith_v2.5.8.jar", versionId: null, enabled: false },
  ],
};

const DONE_JOB = {
  jobId: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  state: "done",
  mcVersion: "1.21.5",
  modLoader: "fabric",
  progress: { done: 3, total: 3 },
  partial: [],
  checkedAt: Date.now(),
  complete: false,
  summary: { available: 1, unavailable: 1, unknown: 1, total: 3 },
  mods: [
    { slug: "sodium", name: "Sodium", availability: "available", iconUrl: ICON },
    { slug: "lithium", name: "Lithium", availability: "unavailable", reason: "No release for 1.21.5" },
    { slug: "terralith", availability: "unknown", reason: "No match on Modrinth for this file." },
  ],
};

interface Scenario {
  installedStatus?: number;
  removeGate?: Promise<void>;
}

let calls: Array<{ method: string; url: string }> = [];
let wrapper: VueWrapper | null = null;
let routePatches: unknown[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function install(scenario: Scenario = {}): void {
  calls = [];
  let installedFails = scenario.installedStatus ?? 0;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url === "/api/servers/smp/mods/installed") {
      if (installedFails) {
        const status = installedFails;
        installedFails = 0;
        return json({ error: "The operation failed unexpectedly." }, status);
      }
      return json(INSTALLED);
    }
    if (url.startsWith("/api/servers/smp/mods/updates")) {
      return json({ mcVersion: "1.21.4", modLoader: "fabric", results: [{ slug: "sodium", status: "update_available", latestVersionId: "new" }] });
    }
    if (url.startsWith("/api/servers/smp/mods/search")) {
      return json({
        hits: [
          {
            projectId: "AANobbMI",
            slug: "sodium",
            title: "Sodium",
            description: "Rendering engine",
            author: "jellysquid3",
            downloads: 2_400_000,
            follows: 1,
            iconUrl: ICON,
            categories: [],
            gameVersions: [],
            environment: "client",
            pageUrl: "https://modrinth.com/mod/sodium",
            installed: true,
          },
          {
            projectId: "krypton",
            slug: "krypton",
            title: "Krypton",
            description: "Network stack",
            author: "iSeeKryptonite",
            downloads: 1_200_000,
            follows: 1,
            iconUrl: null,
            categories: [],
            gameVersions: [],
            environment: "both",
            pageUrl: "https://modrinth.com/mod/krypton",
            installed: false,
          },
        ],
        offset: 0,
        limit: 20,
        totalHits: 2,
      });
    }
    if (url === "/api/servers/smp/mods/compat/versions") return json({ versions: ["1.21.5", "1.21.4"] });
    if (url === "/api/servers/smp/mods/compat" && method === "POST") return json({ jobId: DONE_JOB.jobId });
    if (url.startsWith("/api/servers/smp/mods/compat/")) return json(DONE_JOB);
    if (url === "/api/servers/smp/mods/lithium" && method === "DELETE") {
      await scenario.removeGate;
      return json({ ok: true, slug: "lithium" });
    }
    if (url === "/api/status") {
      return json({
        bot: { alive: true, lastBeat: null, startedAt: null, version: null },
        servers: [{ id: "smp", state: "online", players: { online: 3, max: 20 } }],
      });
    }
    return json({ error: "unexpected" }, 500);
  });
}

function mountView(props: Record<string, unknown> = {}) {
  const Host = defineComponent({
    setup() {
      return () =>
        h("div", [
          h(ModsView, {
            activeServer: "smp",
            ...props,
            "onUpdate-route": (patch: unknown) => routePatches.push(patch),
          }),
          h(TypedConfirmDialog),
        ]);
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: uiGlobal });
  return wrapper;
}

function byLabel(label: string): HTMLElement {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`nothing labelled "${label}"`);
  return el as HTMLElement;
}

function buttonWithText(text: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

function rowOf(name: string): HTMLElement {
  const row = [...document.querySelectorAll("tbody tr")].find((r) => r.querySelector("th")?.textContent?.includes(name));
  if (!row) throw new Error(`no row ${name}`);
  return row as HTMLElement;
}

beforeEach(() => {
  routePatches = [];
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  setCapabilities({ smp: ["server:read", "mods:read", "mods:write"] });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ModsView", () => {
  it("opens with one h1, the server's loader and version, and the check inside the Installed card", async () => {
    install();
    mountView();
    await settle(60);
    const h1s = document.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toContain("Mods");
    expect(document.body.textContent).toContain("Fabric 1.21.4.");
    expect(document.body.textContent).toContain("3 players are online.");
    const card = document.getElementById("mods-installed-h")!.closest("section")!;
    expect(card.querySelector('[role="group"] label')?.textContent).toContain("Target Minecraft version");
    expect(card.textContent).toContain("Check 3 mods for 1.21.4");
  });

  it("shows an icon where Modrinth has one and an initials tile otherwise", async () => {
    install();
    mountView();
    await settle(60);
    const sodium = rowOf("sodium");
    expect(sodium.querySelector("img.mod-icon")?.getAttribute("src")).toBe(ICON);
    const lithium = rowOf("lithium");
    expect(lithium.querySelector("img")).toBeNull();
    expect(lithium.querySelector(".mod-tile")?.textContent).toBe("LI");

    const img = sodium.querySelector("img.mod-icon")!;
    img.dispatchEvent(new Event("error"));
    await settle();
    expect(rowOf("sodium").querySelector(".mod-tile")?.textContent).toBe("SO");
  });

  it("names the state of every row: update, up to date, disabled", async () => {
    install();
    mountView();
    await settle(60);
    expect(rowOf("sodium").textContent).toContain("Update available");
    expect(rowOf("lithium").textContent).toContain("Up to date");
    expect(rowOf("terralith").textContent).toContain("Disabled");
    expect(byLabel("Update sodium").tagName).toBe("BUTTON");
    expect(byLabel("Enable terralith").tagName).toBe("BUTTON");
  });

  it("removes through the confirm dialog with the mod's icon, and keeps the other rows usable", async () => {
    let release!: () => void;
    const removeGate = new Promise<void>((r) => (release = r));
    install({ removeGate });
    mountView();
    await settle(60);
    expect(() => byLabel("Remove sodium")).not.toThrow();
    byLabel("Remove lithium").click();
    await settle(60);

    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Remove lithium from smp?");
    expect(dialog.textContent).toContain("lithium-fabric-0.14.3.jar");
    expect(dialog.textContent).toContain("3 players are online");
    expect(dialog.querySelector(".mod-tile")?.textContent).toBe("LI");
    buttonWithText("Remove lithium", dialog).click();
    await settle(60);

    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/servers/smp/mods/lithium")).toBe(true);
    expect(rowOf("lithium").getAttribute("aria-busy")).toBe("true");
    expect(rowOf("lithium").textContent).toContain("Removing");
    expect((byLabel("Remove sodium") as HTMLButtonElement).disabled).toBe(false);
    release();
    await settle(60);
  });

  it("does nothing when the remove is cancelled", async () => {
    install();
    mountView();
    await settle(60);
    byLabel("Remove lithium").click();
    await settle(60);
    buttonWithText("Keep lithium").click();
    await settle(60);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("shows a load failure in place with Retry instead of an empty list", async () => {
    install({ installedStatus: 502 });
    mountView();
    await settle(60);
    const alert = document.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("The mod list did not load");
    expect(alert.textContent).toContain("GET /api/servers/smp/mods/installed -> 502");
    expect(document.body.textContent).not.toContain("No mods are installed");
    buttonWithText("Reload", alert).click();
    await settle(60);
    expect(rowOf("sodium")).toBeTruthy();
  });

  it("runs the check from the URL and lists blockers first, Unknown counted", async () => {
    install();
    mountView({ check: "1.21.5", filter: "blockers" });
    await settle(120);
    const filters = document.querySelector('[role="group"][aria-label="Filter results"]') as HTMLElement;
    expect(buttonWithText("Blockers 2", filters).getAttribute("aria-pressed")).toBe("true");
    expect(buttonWithText("All 3", filters)).toBeTruthy();
    expect(buttonWithText("Ready 1", filters)).toBeTruthy();
    const names = [...document.querySelectorAll("tbody th .name")].map((th) => th.textContent?.trim());
    expect(names).toEqual(["Lithium", "terralith"]);
    expect(document.body.textContent).toContain("Do not upgrade yet.");
    expect(document.body.textContent).toContain("1 mod has no 1.21.5 build. 1 mod could not be checked.");
    expect(byLabel("Open Lithium on Modrinth").getAttribute("href")).toBe("https://modrinth.com/mod/lithium");

    buttonWithText("Ready 1", filters).click();
    await settle();
    expect([...document.querySelectorAll("tbody th .name")].map((th) => th.textContent?.trim())).toEqual(["Sodium"]);
    expect(routePatches.at(-1)).toEqual({ query: { check: "1.21.5", filter: "ready" } });
  });

  it("shows catalogue icons, the installed state and a labelled version picker", async () => {
    install();
    mountView();
    await settle(60);
    const catalog = document.getElementById("mods-catalog-h")!.closest("section")!;
    expect(catalog.querySelector("img.mod-icon")?.getAttribute("src")).toBe(ICON);
    expect(buttonWithText("Installed", catalog).disabled).toBe(true);
    const add = byLabel("Add Krypton, choose a version");
    expect(add.getAttribute("aria-expanded")).toBe("false");
    expect(catalog.querySelector("label[for='mods-catalog-q']")?.textContent).toBe("Search Modrinth");
  });
});
