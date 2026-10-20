/**
 * The relay end to end through the chat bridge: who receives a message, what
 * they receive, and the opt-out, blocklist, rate limit and edit/delete paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/bot/utils/embeds/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn().mockReturnValue({ type: "player-embed" }),
  createEmbed: vi.fn((o: unknown) => ({ type: "embed", ...(o as object) })),
}));
const tellraw = vi.fn().mockResolvedValue(true);
vi.mock("../../../src/core/utils/minecraft/serverMessages.js", () => ({ tellraw }));

type Handler = (...args: unknown[]) => void;

const bridge = (channelId: string, extra: object = {}) => ({
  channelId,
  server: "main",
  useWebhook: true,
  relayGroup: "grp",
  ...extra,
});

function guilds(extra: Record<string, object> = {}) {
  return {
    g1: { bridgeLabel: "Alpha", chatBridge: bridge("ch1") },
    g2: { bridgeLabel: "Beta", chatBridge: bridge("ch2") },
    ...extra,
  } as never;
}

function world() {
  const sends: Record<string, ReturnType<typeof vi.fn>> = {};
  const hooks: Record<string, { send: ReturnType<typeof vi.fn>; editMessage: ReturnType<typeof vi.fn>; deleteMessage: ReturnType<typeof vi.fn> }> = {};
  const handlers: Record<string, Handler> = {};
  const channelFor = (id: string) => {
    sends[id] ??= vi.fn();
    hooks[id] ??= {
      send: vi.fn().mockResolvedValue({ id: `copy-${id}` }),
      editMessage: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    };
    return {
      send: sends[id],
      fetchWebhooks: vi.fn().mockResolvedValue([{ name: "minecraft-bot bridge", token: "t", ...hooks[id] }]),
      createWebhook: vi.fn(),
    };
  };
  const client = {
    channels: { fetch: vi.fn((id: string) => Promise.resolve(channelFor(id))) },
    on: vi.fn((event: string, h: Handler) => {
      handlers[event] = h;
    }),
  };
  return { client, hooks, sends, handlers };
}

let counter = 0;
function message(over: Record<string, unknown> = {}) {
  counter += 1;
  return {
    id: `m${counter}`,
    author: { id: `u${counter}`, bot: false, displayName: "Steve", ...(over["author"] as object) },
    guild: { id: "g1", name: "Alpha Server" },
    channel: { id: "ch1" },
    content: "hello",
    attachments: new Map(),
    stickers: new Map(),
    reference: null,
    react: vi.fn().mockResolvedValue(undefined),
    ...over,
    ...(over["author"] ? { author: { id: `u${counter}`, bot: false, displayName: "Steve", ...(over["author"] as object) } } : {}),
  };
}

async function boot(cfg = guilds()) {
  const mod = await import("../../../src/bot/logWatcher/watchers/log/chatBridge.js");
  const w = world();
  mod.setupDiscordToMc(w.client as never, cfg, () => ({}) as never, ["main"]);
  const send = async (msg: ReturnType<typeof message>) => {
    w.handlers["messageCreate"]!(msg);
    await new Promise((r) => setTimeout(r, 30));
    await mod.flushBridgeQueues();
    await new Promise((r) => setTimeout(r, 10));
    await mod.flushBridgeQueues();
  };
  return { ...w, send, mod };
}

beforeEach(async () => {
  vi.resetModules();
  tellraw.mockClear();
  const { closeDbForTesting } = await import("../../../src/core/db/index.js");
  closeDbForTesting();
});

describe("relay fan-out", () => {
  it("posts to the other bridges with a censored name, the label and no avatar or mentions (unlinked speaker)", async () => {
    const t = await boot();
    await t.send(message({ content: "hi <@123456789012345678> @everyone" }));
    expect(t.hooks["ch1"]).toBeUndefined();
    expect(t.hooks["ch2"]!.send).toHaveBeenCalledTimes(1);
    const payload = t.hooks["ch2"]!.send.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload["username"]).toMatch(/^S\*\*\*#[0-9a-f]{4} \[Alpha\]$/);
    expect(payload["content"]).toBe("hi @user everyone");
    expect(payload["allowedMentions"]).toEqual({ parse: [] });
    expect(payload).not.toHaveProperty("avatarURL");
    expect(JSON.stringify(payload)).not.toMatch(/u\d+/);
  });

  it("uses the same identity for the in-game prefix", async () => {
    const t = await boot();
    await t.send(message());
    const component = tellraw.mock.calls[0]![2] as { text?: string }[];
    expect(component[1]!.text).toMatch(/^\[S\*\*\*#[0-9a-f]{4}\] $/);
  });

  it("uses the linked Minecraft name when the author linked one", async () => {
    const t = await boot();
    const { getDb } = await import("../../../src/core/db/index.js");
    getDb().prepare("INSERT INTO linked_accounts (discord_id, mc_name) VALUES (?, ?)").run("u-linked", "Notch");
    await t.send(message({ author: { id: "u-linked", displayName: "Someone" } }));
    const payload = t.hooks["ch2"]!.send.mock.calls[0]![0] as { username: string; avatarURL?: string };
    expect(payload.username).toBe("Notch [Alpha]");
    expect(payload.avatarURL).toContain("Notch");
    expect(payload.avatarURL).not.toMatch(/discord/i);
  });

  it("does not relay outside a group, to other servers, or from bot and webhook messages", async () => {
    const cfg = guilds({
      g3: { chatBridge: bridge("ch3", { server: "other" }) },
      g4: { chatBridge: { channelId: "ch4", server: "main", useWebhook: true } },
    });
    const t = await boot(cfg);
    await t.send(message());
    expect(t.hooks["ch3"]).toBeUndefined();
    expect(t.hooks["ch4"]).toBeUndefined();

    t.handlers["messageCreate"]!(message({ channel: { id: "ch2" }, guild: { id: "g2", name: "B" }, author: { bot: true } }));
    await t.mod.flushBridgeQueues();
    expect(t.hooks["ch1"]).toBeUndefined();

    tellraw.mockClear();
    t.handlers["messageCreate"]!(message({ channel: { id: "ch4" }, guild: { id: "g4", name: "D" } }));
    await vi.waitFor(() => expect(tellraw).toHaveBeenCalled());
    await t.mod.flushBridgeQueues();
    expect(t.hooks["ch2"]!.send).toHaveBeenCalledTimes(1);
  });

  it("falls back to an embed when a webhook cannot be used", async () => {
    const t = await boot(guilds({ g2: { bridgeLabel: "Beta", chatBridge: bridge("ch2", { useWebhook: false }) } }));
    await t.send(message());
    expect(t.sends["ch2"]).toHaveBeenCalledTimes(1);
    const sent = t.sends["ch2"]!.mock.calls[0]![0] as { embeds: { author?: { name: string }; iconURL?: string }[]; allowedMentions: unknown };
    expect(sent.embeds[0]!.author!.name).toMatch(/\[Alpha\]$/);
    expect(JSON.stringify(sent)).not.toContain("mc-heads");
    expect(sent.allowedMentions).toEqual({ parse: [] });
  });
});

describe("opt-out, blocklist and limits", () => {
  it("keeps an opted-out author local and marks the message", async () => {
    const { setRelayOptOut } = await import("../../../src/core/utils/stores/relayOptOutStore.js");
    const t = await boot();
    setRelayOptOut("g1", "u-out", true);
    const msg = message({ author: { id: "u-out" } });
    await t.send(msg);
    expect(msg.react).toHaveBeenCalledWith("🚫");
    expect(tellraw).toHaveBeenCalled();
    expect(t.hooks["ch2"]).toBeUndefined();
  });

  it("opting out in one guild does not affect another", async () => {
    const { setRelayOptOut } = await import("../../../src/core/utils/stores/relayOptOutStore.js");
    const t = await boot();
    setRelayOptOut("g2", "u-x", true);
    await t.send(message({ author: { id: "u-x" } }));
    expect(t.hooks["ch2"]!.send).toHaveBeenCalledTimes(1);
  });

  it("keeps blocklisted authors local", async () => {
    const t = await boot(guilds({ g1: { bridgeLabel: "Alpha", bridgeBlocklist: ["u-bad"], chatBridge: bridge("ch1") } }));
    const msg = message({ author: { id: "u-bad" } });
    await t.send(msg);
    expect(msg.react).toHaveBeenCalledWith("🚫");
    expect(t.hooks["ch2"]).toBeUndefined();
  });

  it("drops messages over the group rate limit and reacts", async () => {
    const t = await boot();
    const msgs = Array.from({ length: 22 }, () => message());
    for (const m of msgs) {
      t.handlers["messageCreate"]!(m);
      await new Promise((r) => setTimeout(r, 2));
    }
    await vi.waitFor(() => expect(msgs[21]!.react).toHaveBeenCalledWith("⏳"));
    await t.mod.flushBridgeQueues();
    expect(t.hooks["ch2"]!.send.mock.calls.length).toBe(20);
  });
});

describe("edit and delete sync", () => {
  it("edits and deletes the copies while the window is open", async () => {
    const t = await boot();
    const msg = message({ content: "first" });
    await t.send(msg);
    t.handlers["messageUpdate"]!(msg, { ...msg, partial: false, content: "second <@123456789012345678>", id: msg.id, author: msg.author });
    await vi.waitFor(() => expect(t.hooks["ch2"]!.editMessage).toHaveBeenCalled());
    expect(t.hooks["ch2"]!.editMessage).toHaveBeenCalledWith("copy-ch2", {
      content: "second @user",
      allowedMentions: { parse: [] },
    });
    t.handlers["messageDelete"]!({ id: msg.id });
    await vi.waitFor(() => expect(t.hooks["ch2"]!.deleteMessage).toHaveBeenCalledWith("copy-ch2"));
  });

  it("ignores edits and deletes of messages that were never relayed", async () => {
    const t = await boot();
    await t.send(message());
    t.handlers["messageDelete"]!({ id: "unknown" });
    t.handlers["messageUpdate"]!({}, { partial: false, id: "unknown", content: "x", author: { bot: false }, attachments: new Map(), stickers: new Map() });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.hooks["ch2"]!.deleteMessage).not.toHaveBeenCalled();
    expect(t.hooks["ch2"]!.editMessage).not.toHaveBeenCalled();
  });
});
