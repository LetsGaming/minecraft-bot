// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import GuildsView from "../../../src/web/frontend/src/views/GuildsView.vue";
import { uiGlobal, settle } from "./mountUi";

// PrimeVue Select listens for orientation changes; jsdom has no matchMedia.
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

let wrapper: VueWrapper | null = null;
let events: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TOKEN_REJECTED = () =>
  json({ error: "Couldn't reach Discord: Discord API error (401).", code: "DISCORD_TOKEN_REJECTED" }, 502);

function install(guilds: () => Response): void {
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    if (url === "/api/guilds") return guilds();
    if (url === "/api/setup/guilds") return json({ guilds: [{ id: "111", name: "Block Party", icon: null, manageable: true }] });
    return json({ error: "unexpected" }, 500);
  });
}

function mountView(sysadmin = true) {
  const Host = defineComponent({
    setup() {
      return () =>
        h(GuildsView, {
          sysadmin,
          "onGoto-config": () => events.push("goto-config"),
        });
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: uiGlobal });
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  events = [];
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("GuildsView", () => {
  it("names a rejected bot token instead of claiming there are no guilds", async () => {
    install(TOKEN_REJECTED);
    const w = mountView();
    await settle();
    expect(w.find("h1").text()).toBe("Guilds");
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain("Discord rejected the bot token");
    expect(alert.text()).toContain("Paste the current token into Config");
    expect(alert.text()).toContain("HTTP 502");
    expect(w.text()).not.toContain("No guilds set up yet");
    expect(w.findAll("button").some((b) => b.text() === "Set up a guild")).toBe(false);
    await w.findAll("button").find((b) => b.text() === "Open Config")!.trigger("click");
    expect(events).toEqual(["goto-config"]);
  });

  it("tells a guild manager whom to ask, without a Config button", async () => {
    install(TOKEN_REJECTED);
    const w = mountView(false);
    await settle();
    expect(w.find('[role="alert"]').text()).toContain("Ask a bot admin to check the bot token");
    expect(w.findAll("button").some((b) => b.text() === "Open Config")).toBe(false);
  });

  it("names a missing token and an unreachable Discord apart", async () => {
    install(() => json({ error: "Couldn't reach Discord: no token", code: "DISCORD_TOKEN_MISSING" }, 503));
    let w = mountView();
    await settle();
    expect(w.find('[role="alert"]').text()).toContain("The bot has no Discord token");
    w.unmount();

    install(() => json({ error: "Couldn't reach Discord: Discord API error (500).", code: "BAD_GATEWAY" }, 502));
    w = mountView();
    await settle();
    expect(w.find('[role="alert"]').text()).toContain("Discord could not be reached");
  });

  it("retries in place and shows the list once Discord answers", async () => {
    let fail = true;
    install(() => (fail ? TOKEN_REJECTED() : json({ guilds: [{ id: "111", configured: true, features: ["chatBridge"] }] })));
    const w = mountView();
    await settle();
    fail = false;
    await w.findAll("button").find((b) => b.text() === "Try again")!.trigger("click");
    await settle();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.find("h3").text()).toBe("Block Party");
    expect(w.find(".gv-chips").text()).toContain("Chat bridge");
  });

  it("separates an empty bot from a bot waiting to be set up", async () => {
    install(() => json({ guilds: [] }));
    let w = mountView();
    await settle();
    expect(w.find("h2").text()).toBe("No guilds set up yet");
    expect(w.text()).toContain("The bot is not in a Discord server you manage yet");
    expect(w.findAll("button").some((b) => b.text() === "Set up first guild")).toBe(false);
    w.unmount();

    install(() => json({ guilds: [{ id: "111", configured: false, features: [] }] }));
    w = mountView();
    await settle();
    expect(w.text()).toContain("The bot is in 1 Discord server you manage, and it is not set up yet");
    expect(w.findAll("button").some((b) => b.text() === "Set up first guild")).toBe(true);
  });

  it("keeps the invite hint as one line of text beside its icon", async () => {
    install(() => json({ guilds: [] }));
    const w = mountView();
    await settle();
    const hint = w.find(".gv-invite");
    expect(hint.element.children).toHaveLength(2);
    expect(hint.find("span").text()).toBe(
      "Not listed? Use Add to Discord in the sidebar to invite the bot to a Discord server you manage, then set it up here.",
    );
  });
});
