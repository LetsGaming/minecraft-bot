import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/bot/utils/embeds/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn(),
  createEmbed: vi.fn((o: { title?: string; description?: string }) => ({ data: o })),
}));

const bridge = (channelId: string, extra: object = {}) => ({ channelId, server: "main", relayGroup: "grp", ...extra });
const guildsOf = (extra: Record<string, object> = {}) =>
  ({
    g1: { bridgeLabel: "Alpha", chatBridge: bridge("ch1") },
    g2: { bridgeLabel: "Beta", chatBridge: bridge("ch2") },
    ...extra,
  }) as never;

function fakeClient() {
  const messages = new Map<string, { id: string; edit: ReturnType<typeof vi.fn> }>();
  let next = 0;
  const pin = vi.fn().mockResolvedValue(undefined);
  const channels = new Map<string, unknown>();
  const channelFor = (id: string) => {
    if (!channels.has(id)) {
      channels.set(id, {
        send: vi.fn(async () => {
          const message = { id: `n${++next}`, edit: vi.fn().mockResolvedValue(undefined), pin };
          messages.set(message.id, message);
          return message;
        }),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            const found = messages.get(messageId);
            if (!found) throw new Error("gone");
            return found;
          }),
          delete: vi.fn(async (messageId: string) => void messages.delete(messageId)),
        },
      });
    }
    return channels.get(id) as { send: ReturnType<typeof vi.fn>; messages: { delete: ReturnType<typeof vi.fn> } };
  };
  return {
    client: { channels: { fetch: vi.fn((id: string) => Promise.resolve(channelFor(id))) }, guilds: { cache: new Map() } },
    channelFor,
    pin,
    messages,
  };
}

beforeEach(async () => {
  vi.resetModules();
  const { closeDbForTesting } = await import("../../../src/core/db/index.js");
  closeDbForTesting();
});

describe("relay opt-out button ids", () => {
  it("round-trips the guild id and rejects ids that are not ours", async () => {
    const { optOutCustomId, parseOptOutCustomId } = await import("../../../src/bot/interactions/relayNotice.js");
    expect(parseOptOutCustomId(optOutCustomId("123"))).toBe("123");
    expect(parseOptOutCustomId("hint:yes:a:b:c")).toBeNull();
    expect(parseOptOutCustomId("relay:optout")).toBeNull();
  });
});

describe("relay notices", () => {
  it("posts and pins one notice per relayed channel, naming the other servers", async () => {
    const { ensureRelayNotices } = await import("../../../src/bot/interactions/relayNotice.js");
    const w = fakeClient();
    await ensureRelayNotices(w.client as never, guildsOf(), ["main"]);
    const sent1 = w.channelFor("ch1").send.mock.calls[0]![0] as { embeds: { data: { description: string } }[] };
    expect(sent1.embeds[0]!.data.description).toContain("Beta");
    expect(sent1.embeds[0]!.data.description).not.toContain("Alpha");
    expect(w.channelFor("ch2").send).toHaveBeenCalledTimes(1);
    expect(w.pin).toHaveBeenCalledTimes(2);
  });

  it("does nothing the second time, edits when the group changes, removes when relaying stops", async () => {
    const { ensureRelayNotices } = await import("../../../src/bot/interactions/relayNotice.js");
    const w = fakeClient();
    await ensureRelayNotices(w.client as never, guildsOf(), ["main"]);
    await ensureRelayNotices(w.client as never, guildsOf(), ["main"]);
    expect(w.channelFor("ch1").send).toHaveBeenCalledTimes(1);

    const three = guildsOf({ g3: { bridgeLabel: "Gamma", chatBridge: bridge("ch3") } });
    await ensureRelayNotices(w.client as never, three, ["main"]);
    expect(w.channelFor("ch1").send).toHaveBeenCalledTimes(1);
    expect(w.messages.get("n1")!.edit).toHaveBeenCalledTimes(1);

    const alone = { g1: { bridgeLabel: "Alpha", chatBridge: bridge("ch1") } } as never;
    await ensureRelayNotices(w.client as never, alone, ["main"]);
    expect(w.channelFor("ch1").messages.delete).toHaveBeenCalled();
    expect(w.channelFor("ch2").messages.delete).toHaveBeenCalled();
  });

  it("opts the pressing member out in that guild only", async () => {
    const { handleRelayInteraction, optOutCustomId } = await import("../../../src/bot/interactions/relayNotice.js");
    const { isRelayOptedOut } = await import("../../../src/core/utils/stores/relayOptOutStore.js");
    const reply = vi.fn().mockResolvedValue(undefined);
    const press = (guildId: string) => ({
      isButton: () => true,
      customId: optOutCustomId("g1"),
      guildId,
      user: { id: "u1" },
      reply,
    });
    expect(await handleRelayInteraction(press("g1") as never)).toBe(true);
    expect(isRelayOptedOut("g1", "u1")).toBe(true);
    expect(reply.mock.calls[0]![0]).toMatchObject({ ephemeral: true });

    expect(await handleRelayInteraction(press("other") as never)).toBe(true);
    expect(isRelayOptedOut("other", "u1")).toBe(false);
    expect(await handleRelayInteraction({ isButton: () => true, customId: "hint:yes:a:b:c" } as never)).toBe(false);
  });
});
