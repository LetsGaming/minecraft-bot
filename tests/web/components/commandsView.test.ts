// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import CommandsView from "../../../src/web/frontend/src/views/CommandsView.vue";
import TypedConfirmDialog from "../../../src/web/frontend/src/components/ui/TypedConfirmDialog.vue";
import { clearDirtySources } from "../../../src/web/frontend/src/composables/useUnsavedGuard";
import { uiGlobal, settle } from "./mountUi";

// PrimeVue Select listens for orientation changes; jsdom has no matchMedia.
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

let wrapper: VueWrapper | null = null;
let navigated: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function payload(globalOverrides: Record<string, unknown> = {}) {
  return {
    hash: "h1",
    manifest: {
      slash: [
        { name: "ping", description: "Is the bot there", category: "info" },
        { name: "ban", description: "Ban a player", category: "moderation" },
      ],
      ingame: [{ name: "spawn", description: "Back to spawn", category: "general" }],
    },
    usage: { windowDays: 30, byCommand: { ping: { count: 4, users: 1, lastUsedAt: null } } },
    scopes: { guildIds: [], serverIds: ["smp"] },
    commandOptions: {},
    overrides: { global: globalOverrides, guilds: {}, servers: {} },
    effective: {
      ping: { global: { enabled: true, adminOnly: false } },
      ban: { global: { enabled: false, adminOnly: true } },
    },
  };
}

function install(commands: () => Response): void {
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    if (url === "/api/commands") return commands();
    if (url === "/api/setup/guilds") return json({ guilds: [] });
    if (url === "/api/config/status") return json({ state: "applied", restartRequired: [] });
    return json({ error: "unexpected" }, 500);
  });
}

function mountView() {
  const Host = defineComponent({
    setup() {
      return () =>
        h("div", [
          h(CommandsView, { onNavigate: (to: string) => navigated.push(to) }),
          h(TypedConfirmDialog),
        ]);
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: uiGlobal });
  return wrapper;
}

function nameOf(el: Element): string {
  const ids = el.getAttribute("aria-labelledby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent?.trim()).join(" ");
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  navigated = [];
  document.body.innerHTML = "";
  clearDirtySources();
  vi.unstubAllGlobals();
});

describe("CommandsView", () => {
  it("opens with an h1, the edit bar and filters with bound labels", async () => {
    install(() => json(payload()));
    const w = mountView();
    await settle();
    expect(w.find("h1").text()).toBe("Commands");
    expect(w.find('[role="region"]').text()).toContain("Nothing to save");
    const find = document.getElementById("cmd-find");
    expect(find?.tagName).toBe("INPUT");
    expect(document.querySelector('label[for="cmd-find"]')?.textContent).toBe("Find");
    expect(document.querySelector('[aria-labelledby="cmd-scope-label"]')).not.toBeNull();
    expect(w.text()).toContain("4 uses by 1 person in 30 days");
    expect(w.text()).toContain("Not used in 30 days");
  });

  it("names every per-command control after the command and the setting", async () => {
    install(() => json(payload()));
    mountView();
    await settle();
    const groups = [...document.querySelectorAll('.cmd-card [aria-labelledby]')];
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map(nameOf)).toContain("/ping Enabled");
    expect(groups.map(nameOf)).toContain("/ban Who can use it");
    expect(groups.map(nameOf).every((n) => !n.includes("undefined"))).toBe(true);
  });

  it("shows the state as a shaped chip and counts edits in the edit bar", async () => {
    install(() => json(payload()));
    const w = mountView();
    await settle();
    expect(w.find(".cmd-card.off").text()).toContain("Off, admins only");
    const off = [...document.querySelectorAll('.cmd-card [aria-labelledby]')].find((g) => nameOf(g) === "/ping Enabled")!;
    const offButton = [...off.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Off")!;
    offButton.click();
    await settle();
    const bar = w.find('[role="region"]');
    expect(bar.text()).toContain("1 unsaved change");
    expect(bar.text()).toContain("Save 1 change");
  });

  it("asks before resetting a scope and clears its overrides as a draft", async () => {
    install(() => json(payload({ ping: { enabled: false } })));
    const w = mountView();
    await settle();
    const reset = w.findAll("button").find((b) => b.text() === "Reset Global defaults")!;
    await reset.trigger("click");
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("This clears 1 override on Global defaults");
    const accept = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Clear overrides")!;
    accept.click();
    await settle();
    expect(w.find('[role="region"]').text()).toContain("1 unsaved change");
  });

  it("says the bot has not listed its commands instead of showing an empty editor", async () => {
    install(() => json({ error: "Command manifest not written yet.", code: "UNAVAILABLE" }, 503));
    const w = mountView();
    await settle();
    expect(w.find("h2").text()).toBe("The bot has not listed its commands yet");
    expect(w.find('[role="region"]').exists()).toBe(false);
    expect(document.getElementById("cmd-find")).toBeNull();
    await w.findAll("button").find((b) => b.text() === "Open Overview")!.trigger("click");
    expect(navigated).toEqual(["overview"]);
  });

  it("shows any other load failure in place with a working retry", async () => {
    let fail = true;
    install(() => (fail ? json({ error: "Internal server error" }, 500) : json(payload())));
    const w = mountView();
    await settle();
    expect(w.find('[role="alert"]').text()).toContain("The command list could not be loaded");
    fail = false;
    await w.findAll("button").find((b) => b.text() === "Try again")!.trigger("click");
    await settle();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.text()).toContain("/ping");
  });
});
