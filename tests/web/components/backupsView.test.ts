// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import BackupsView from "../../../src/web/frontend/src/views/BackupsView.vue";
import TypedConfirmDialog from "../../../src/web/frontend/src/components/ui/TypedConfirmDialog.vue";
import { setCapabilities } from "../../../src/web/frontend/src/composables/useCapabilities";
import { uiGlobal, settle } from "./mountUi";

const FILES = [
  { id: "AAAAAAAAAAAAAAAAAAAAAA", tier: "hourly", name: "smp-hourly-2026-10-10_14-00.tar.zst", sizeBytes: 3_810_000_000, mtimeMs: Date.now() - 35 * 60_000 },
  { id: "BBBBBBBBBBBBBBBBBBBBBB", tier: "archives/daily", name: "smp-daily-2026-10-10_03-00.tar.zst", sizeBytes: 3_780_000_000, mtimeMs: Date.now() - 11 * 3_600_000 },
];
const MORE = [
  { id: "CCCCCCCCCCCCCCCCCCCCCC", tier: "archives/update", name: "smp-preupdate-2026-10-08_21-15.tar.zst", sizeBytes: 3_650_000_000, mtimeMs: Date.now() - 2 * 86_400_000 },
];

interface Scenario {
  state: "online" | "offline";
  listStatus?: number;
  restore?: { ok: boolean; exitCode: number; output: string; stderr: string };
}

let calls: Array<{ method: string; url: string }> = [];
let wrapper: VueWrapper | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function install(scenario: Scenario): void {
  calls = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.startsWith("/api/servers/smp/backups/files?")) {
      if (scenario.listStatus) return json({ error: "The operation failed unexpectedly." }, scenario.listStatus);
      return url.includes("cursor=")
        ? json({ files: MORE, nextCursor: null, total: 3 })
        : json({ files: FILES, nextCursor: "next", total: 3, stale: null });
    }
    if (url === "/api/servers/smp/backups/summary") {
      return json({
        dirs: [
          { dir: "hourly", count: 1, latestFile: FILES[0]!.name, latestMtimeMs: FILES[0]!.mtimeMs, latestSizeBytes: FILES[0]!.sizeBytes },
          { dir: "archives/daily", count: 1, latestFile: FILES[1]!.name, latestMtimeMs: FILES[1]!.mtimeMs, latestSizeBytes: FILES[1]!.sizeBytes },
          { dir: "archives/update", count: 1, latestFile: MORE[0]!.name, latestMtimeMs: MORE[0]!.mtimeMs, latestSizeBytes: MORE[0]!.sizeBytes },
        ],
        totalBytes: 11_240_000_000,
        stale: null,
      });
    }
    if (url === "/api/status") {
      return json({
        bot: { alive: true, lastBeat: null, startedAt: null, version: null },
        servers: [
          {
            id: "smp",
            state: scenario.state,
            players: scenario.state === "online" ? { online: 3, max: 20 } : null,
            features: { scripts: { backup: true }, restore: true, backupFiles: true, backupDelete: true },
          },
        ],
      });
    }
    if (url.endsWith("/restore") && method === "POST") return json(scenario.restore);
    return json({ error: "unexpected" }, 500);
  });
}

function mountView() {
  const Host = defineComponent({
    emits: ["navigate"],
    setup(_props, { emit }) {
      return () =>
        h("div", [
          h(BackupsView, {
            serverIds: ["smp"],
            activeServer: "smp",
            onNavigate: (to: string) => emit("navigate", to),
          }),
          h(TypedConfirmDialog),
        ]);
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: uiGlobal });
  return wrapper;
}

function byLabel(label: string): HTMLButtonElement {
  const el = document.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`no button labelled "${label}"`);
  return el as HTMLButtonElement;
}

function dialogButton(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('[role="alertdialog"] button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no dialog button "${text}"`);
  return found as HTMLButtonElement;
}

beforeEach(() => {
  setCapabilities({ smp: ["server:read", "server:control", "backup:restore", "backup:delete", "backup:download"] });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("BackupsView", () => {
  it("lists backups with named, distinct row actions, tiles and type filter", async () => {
    install({ state: "online" });
    const w = mountView();
    await settle();
    expect(w.find("h1").text()).toBe("Backups");
    expect(byLabel("Restore smp-hourly-2026-10-10_14-00").textContent).toContain("Restore");
    expect(byLabel("Delete smp-hourly-2026-10-10_14-00").className).toContain("p-button-danger");
    expect(byLabel("Restore smp-hourly-2026-10-10_14-00").className).not.toContain("p-button-danger");
    expect(byLabel("Download smp-hourly-2026-10-10_14-00")).toBeTruthy();
    expect(w.text()).toContain("10.5 GB");
    const chips = w.findAll(".filters button");
    expect(chips.map((c) => c.text())).toEqual(["All 3", "Hourly 1", "Daily 1", "Pre-update 1"]);
    await chips[1]!.trigger("click");
    expect(chips[1]!.attributes("aria-pressed")).toBe("true");
    expect(w.findAll("tbody tr")).toHaveLength(1);
  });

  it("pages forward with the cursor", async () => {
    install({ state: "online" });
    const w = mountView();
    await settle();
    expect(w.text()).toContain("Showing 2 of 3");
    const more = w.findAll("button").find((b) => b.text() === "Load 1 more")!;
    await more.trigger("click");
    await settle();
    expect(calls.some((c) => c.url.includes("cursor=next"))).toBe(true);
    expect(w.findAll("tbody tr")).toHaveLength(3);
  });

  it("blocks restore while the server is online and offers Servers instead", async () => {
    install({ state: "online" });
    const w = mountView();
    await settle();
    byLabel("Restore smp-hourly-2026-10-10_14-00").click();
    await settle(60);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("smp is online with 3 players");
    expect(dialog.textContent).toContain("There is no undo.");
    expect(document.getElementById("typed-confirm")).toBeNull();
    expect(dialogButton("Restore smp").disabled).toBe(true);
    dialogButton("Open Servers to stop smp").click();
    await settle();
    expect(w.emitted("navigate")?.[0]).toEqual(["status"]);
    expect(calls.some((c) => c.url.endsWith("/restore"))).toBe(false);
  });

  it("restores a stopped server after the name is typed and shows the output", async () => {
    install({
      state: "offline",
      restore: { ok: true, exitCode: 0, output: "[INFO] Server data restored.", stderr: "" },
    });
    const w = mountView();
    await settle();
    byLabel("Restore smp-hourly-2026-10-10_14-00").click();
    await settle(60);
    expect(document.activeElement?.id).toBe("typed-confirm");
    const input = document.getElementById("typed-confirm") as HTMLInputElement;
    input.value = "smp";
    input.dispatchEvent(new Event("input"));
    await settle(5);
    dialogButton("Restore smp").click();
    await settle(60);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith(`/backups/files/${FILES[0]!.id}/restore`))).toBe(true);
    expect(w.text()).toContain("Restore finished");
    expect(w.text()).toContain("Exit code 0");
    expect(w.find("pre").text()).toBe("[INFO] Server data restored.");
    expect(w.text()).toContain("smp is still stopped");
  });

  it("explains a read-only user and keeps write controls off", async () => {
    setCapabilities({ smp: ["server:read"] });
    install({ state: "offline" });
    const w = mountView();
    await settle();
    expect(w.text()).toContain("You can see the backups but not change them.");
    expect(w.text()).toContain("Creating needs server:control, restoring backup:restore and deleting backup:delete.");
    expect(byLabel("Restore smp-hourly-2026-10-10_14-00").disabled).toBe(true);
    expect(document.querySelector('button[aria-label^="Download"]')).toBeNull();
  });

  it("shows a load error with its cause and Retry", async () => {
    install({ state: "online", listStatus: 502 });
    const w = mountView();
    await settle();
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain("The backup list did not load");
    expect(alert.text()).toContain("GET /api/servers/smp/backups/files -> 502");
    expect(alert.findAll("button").map((b) => b.text())).toContain("Try again");
  });
});
