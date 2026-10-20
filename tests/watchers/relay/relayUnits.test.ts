import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting, getDb } from "../../../src/core/db/index.js";
import {
  censorName,
  cleanLabel,
  relaySpeaker,
  relayTag,
  webhookUsername,
} from "../../../src/bot/logWatcher/watchers/log/relay/identity.js";
import { transformRelayContent } from "../../../src/bot/logWatcher/watchers/log/relay/transform.js";
import { RelaySyncMap } from "../../../src/bot/logWatcher/watchers/log/relay/syncMap.js";
import { relayGroupSecret } from "../../../src/core/utils/stores/relaySecretStore.js";
import { isRelayOptedOut, setRelayOptOut } from "../../../src/core/utils/stores/relayOptOutStore.js";

beforeEach(() => {
  closeDbForTesting();
});

const input = (over: Partial<Parameters<typeof transformRelayContent>[0]> = {}) => ({
  content: "",
  attachments: [],
  stickers: 0,
  isReply: false,
  ...over,
});

describe("transformRelayContent", () => {
  it("turns mentions into plain words and never keeps ids", () => {
    const text = transformRelayContent(
      input({ content: "hi <@123456789012345678> <@!987654321098765432> <@&111111111111111111> <#222222222222222222> @everyone @here" }),
    );
    expect(text).toBe("hi @user @user @role #channel everyone here");
    expect(text).not.toMatch(/\d{10}/);
  });

  it("replaces custom emoji, timestamps, Discord links and invites", () => {
    const text = transformRelayContent(
      input({
        content:
          "<:kek:123456789012345678> <a:dance:123456789012345679> <t:1700000000:R> " +
          "https://discord.com/channels/1/2/3 discord.gg/abcd https://discord.com/invite/xyz",
      }),
    );
    expect(text).toBe(":kek: :dance: [time] [link] [invite] [invite]");
  });

  it("marks attachments, stickers and replies without quoting anything", () => {
    expect(
      transformRelayContent(input({ attachments: ["image/png", "application/zip"], stickers: 1, isReply: true })),
    ).toBe("(reply) [image] [file] [sticker]");
  });

  it("strips control characters, flattens newlines and caps at 2000", () => {
    expect(transformRelayContent(input({ content: "a\nb​c\u0007" }))).toBe("a bc");
    expect([...transformRelayContent(input({ content: "x".repeat(3000) }))!]).toHaveLength(2000);
  });

  it("returns null when nothing is left", () => {
    expect(transformRelayContent(input({ content: "  \n " }))).toBeNull();
    expect(transformRelayContent(input({ isReply: true }))).toBeNull();
  });
});

describe("censorName and webhook username", () => {
  it("keeps the first code point and a fixed mask", () => {
    expect(censorName("Steve")).toBe("S***");
    expect(censorName("Al")).toBe("A***");
    expect(censorName("😀Party")).toBe("😀***");
    expect(censorName("山田太郎")).toBe("山***");
    expect(censorName("")).toBe("?***");
  });

  it("drops trailing brackets so a name cannot imitate a label", () => {
    expect(censorName("Eve [Alpha]")).toBe("E***");
    expect(censorName("Eve (Admin) [Mod]")).toBe("E***");
    expect(censorName("[Admin] Eve")).toBe("[***");
  });

  it("builds Name [Label] within 80 characters, shortening the name first", () => {
    expect(webhookUsername("S***#ab12", "Alpha")).toBe("S***#ab12 [Alpha]");
    const long = webhookUsername("n".repeat(200), "Alpha");
    expect([...long]).toHaveLength(80);
    expect(long.endsWith(" [Alpha]")).toBe(true);
  });

  it("cleans labels of brackets and control characters", () => {
    expect(cleanLabel("[Evil]\n(x) Lab")).toBe("Evilx Lab");
    expect([...cleanLabel("y".repeat(60))]).toHaveLength(24);
    expect(cleanLabel("   ")).toBe("?");
  });
});

describe("relayName", () => {
  it("uses the linked Minecraft name when there is one", async () => {
    getDb().prepare("INSERT INTO linked_accounts (discord_id, mc_name) VALUES (?, ?)").run("u1", "Notch");
    expect(await relaySpeaker("u1", "Someone", "main")).toEqual({ name: "Notch", linked: true });
  });

  it("gives unlinked users a censored name and a stable tag that holds no id", async () => {
    const a = (await relaySpeaker("111111111111111111", "Steve", "main")).name;
    expect(a).toMatch(/^S\*\*\*#[0-9a-f]{4}$/);
    expect((await relaySpeaker("111111111111111111", "Steve", "main")).name).toBe(a);
    expect((await relaySpeaker("111111111111111111", "Steve", "main")).linked).toBe(false);
    expect(a).not.toContain("1111");
  });

  it("tells two users apart and does not repeat a tag across groups by design", async () => {
    const secretA = relayGroupSecret("a");
    expect(relayGroupSecret("a")).toBe(secretA);
    expect(relayGroupSecret("b")).not.toBe(secretA);
    expect(relayTag("u1", secretA)).toMatch(/^[0-9a-f]{4}$/);
    expect(relayTag("u1", secretA)).not.toBe(relayTag("u1", relayGroupSecret("b")));
  });
});

describe("RelaySyncMap", () => {
  const copy = { channelId: "c", messageId: "m", viaWebhook: true };

  it("remembers copies inside the window and forgets them after it", () => {
    const map = new RelaySyncMap();
    map.remember("s1", [copy], 1000, 0);
    expect(map.copiesOf("s1", 999)).toEqual([copy]);
    expect(map.copiesOf("s1", 1000)).toBeNull();
    expect(map.size).toBe(0);
  });

  it("ignores an empty copy list and can forget on demand", () => {
    const map = new RelaySyncMap();
    map.remember("s1", [], 1000, 0);
    expect(map.size).toBe(0);
    map.remember("s2", [copy], 1000, 0);
    map.forget("s2");
    expect(map.copiesOf("s2", 1)).toBeNull();
  });
});

describe("relay opt-out store", () => {
  it("is per guild and reports whether anything changed", () => {
    expect(isRelayOptedOut("g1", "u1")).toBe(false);
    expect(setRelayOptOut("g1", "u1", true)).toBe(true);
    expect(setRelayOptOut("g1", "u1", true)).toBe(false);
    expect(isRelayOptedOut("g1", "u1")).toBe(true);
    expect(isRelayOptedOut("g2", "u1")).toBe(false);
    expect(setRelayOptOut("g1", "u1", false)).toBe(true);
    expect(isRelayOptedOut("g1", "u1")).toBe(false);
  });
});
