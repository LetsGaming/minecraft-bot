// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import SetupWizard from "../../../src/web/frontend/src/components/SetupWizard.vue";
import { uiGlobal, settle } from "./mountUi";

// PrimeVue Select listens for orientation changes; jsdom has no matchMedia.
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

let wrapper: VueWrapper | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface Scenario {
  setupGuilds?: () => Response;
  channels?: () => Response;
}

function install(s: Scenario = {}): void {
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    if (url === "/api/setup/guilds") {
      return s.setupGuilds?.() ?? json({ guilds: [{ id: "111", name: "Block Party", icon: null, manageable: true }] });
    }
    if (url === "/api/guilds") return json({ guilds: [{ id: "111", configured: true, features: [] }] });
    if (url === "/api/setup/servers") return json({ servers: ["smp"] });
    if (url === "/api/guilds/111/config") return json({ hash: "h", guildConfig: { defaultServer: "smp" } });
    if (url === "/api/setup/guilds/111/channels") {
      return s.channels?.() ?? json({ channels: [{ id: "c1", name: "general", type: 0, position: 0, parentId: null }] });
    }
    if (url === "/api/setup/guilds/111/roles") return json({ roles: [] });
    return json({ error: "unexpected" }, 500);
  });
}

function mountWizard(initialGuildId = "") {
  const visible = ref(false);
  const Host = defineComponent({
    setup() {
      return () =>
        h(SetupWizard, {
          visible: visible.value,
          initialGuildId,
          sysadmin: true,
          "onUpdate:visible": (v: boolean) => (visible.value = v),
        });
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: uiGlobal });
  visible.value = true;
  return wrapper;
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("SetupWizard", () => {
  it("says a rejected token is the problem and retries in place", async () => {
    let fail = true;
    install({
      setupGuilds: () =>
        fail
          ? json({ error: "Couldn't reach Discord: Discord API error (401).", code: "DISCORD_TOKEN_REJECTED" }, 502)
          : json({ guilds: [{ id: "111", name: "Block Party", icon: null, manageable: true }] }),
    });
    mountWizard();
    await settle(60);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("Discord rejected the bot token");
    fail = false;
    button("Try again").click();
    await settle(60);
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(document.getElementById("wiz-guild-label")?.textContent).toBe("Which Discord server should the bot be set up for?");
  });

  it("marks the current step and binds each feature toggle to its label", async () => {
    install();
    mountWizard("111");
    await settle(60);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Guild");
    button("Next").click();
    await settle(60);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Features");
    const toggle = document.getElementById("wiz-f-chatBridge") as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(document.querySelector('label[for="wiz-f-chatBridge"]')?.textContent?.trim()).toBe("Chat bridge");
    expect(toggle.getAttribute("aria-describedby")).toBe("wiz-fh-chatBridge");
  });

  it("keeps a failed channel read on the features step with Retry and no way forward", async () => {
    install({ channels: () => json({ error: "Couldn't reach Discord", code: "BAD_GATEWAY" }, 502) });
    mountWizard("111");
    await settle(60);
    button("Next").click();
    await settle(60);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Features");
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Discord could not be reached");
    expect(button("Next").disabled).toBe(true);
  });
});
