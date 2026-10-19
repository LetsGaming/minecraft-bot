/**
 * Tests for the account linking flow.
 *
 * Covers:
 *  - generateCode: output format (randomBytes hex encoding)
 *  - logWatcher link handler: happy path, unknown code, expiry,
 *    name-taken, rate limiting — against a mocked confirmLinkCode
 *    (the atomic store op that replaced the module-level codes cache)
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";

// ── Top-level mocks — must be at file scope for Vitest hoisting ───────────

vi.mock("../../src/core/utils/stores/linkUtils.js", () => ({
  confirmLinkCode: vi.fn(),
  loadLinkedAccountsOrEmpty: vi.fn().mockResolvedValue({}),
  findDiscordIdByMcName: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/core/utils/commands/commandPolicy.js", () => ({
  resolveCommandPolicy: vi.fn().mockReturnValue({ enabled: true, adminOnly: false }),
}));

vi.mock("../../src/core/utils/commands/commandUsage.js", () => ({
  recordCommandUsage: vi.fn(),
}));

vi.mock("../../src/bot/utils/guild/linkedRole.js", () => ({
  syncLinkedRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/minecraft/serverMessages.js", () => ({
  whisper: vi.fn().mockResolvedValue(undefined),
  tellraw: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { confirmLinkCode } from "../../src/core/utils/stores/linkUtils.js";
import { whisper } from "../../src/core/utils/minecraft/serverMessages.js";
import { syncLinkedRole } from "../../src/bot/utils/guild/linkedRole.js";

// ── Code generation ────────────────────────────────────────────────────────

describe("link code format", () => {
  it("has exactly 8 hex characters (4 bytes → 8 hex chars)", () => {
    const code = randomBytes(4).toString("hex").toUpperCase();
    expect(code).toMatch(/^[0-9A-F]{8}$/);
  });

  it("produces unique codes on successive calls", () => {
    const codes = new Set(
      Array.from({ length: 50 }, () =>
        randomBytes(4).toString("hex").toUpperCase(),
      ),
    );
    expect(codes.size).toBe(50);
  });
});

// ── logWatcher !link handler ───────────────────────────────────────────────

describe("logWatcher link handler", () => {
  beforeAll(async () => {
    await import("../../src/bot/logWatcher/commands/connection/link.js");
  }, 120_000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function loadHandler() {
    const mod = await import("../../src/bot/logWatcher/commands/connection/link.js");
    await mod.init();
    return mod.handler;
  }

  function makeClient(discordId: string) {
    const send = vi.fn().mockResolvedValue(undefined);
    return {
      client: {
        users: { fetch: vi.fn().mockResolvedValue({ id: discordId, send }) },
      },
      send,
    };
  }

  it("links account on valid code: syncs role and DMs success", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({
      status: "linked",
      discordId: "discord-99",
    });
    const handler = await loadHandler();
    const { client, send } = makeClient("discord-99");

    await handler("Steve", { code: "ABCD1234" }, client as never, null as never);

    expect(confirmLinkCode).toHaveBeenCalledWith("ABCD1234", "Steve");
    expect(syncLinkedRole).toHaveBeenCalledWith(client, "discord-99", "add");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Linked"));
  });

  it("ignores unknown code: no role sync, no DM", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({ status: "unknown-code" });
    const handler = await loadHandler();
    const { client, send } = makeClient("discord-99");

    await handler("Steve", { code: "XXXXXXXX" }, client as never, null as never);

    expect(syncLinkedRole).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects expired code and does not link", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({
      status: "expired",
      discordId: "discord-42",
    });
    const handler = await loadHandler();
    const { client, send } = makeClient("discord-42");

    await handler("Steve", { code: "EXPIRED1" }, client as never, null as never);

    expect(syncLinkedRole).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("expired"));
  });

  it("rejects a username owned by a different Discord account", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({
      status: "name-taken",
      discordId: "discord-7",
    });
    const handler = await loadHandler();
    const { client, send } = makeClient("discord-7");

    await handler("Steve", { code: "TAKEN123" }, client as never, null as never);

    expect(syncLinkedRole).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("different Discord account"),
    );
  });

  it("whispers the sender when the code was already used", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({ status: "already-used" });
    const handler = await loadHandler();
    const { client, send } = makeClient("discord-1");
    const server = { id: "main" };

    await handler("Mallory", { code: "USED1111" }, client as never, server as never);

    expect(syncLinkedRole).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(whisper).toHaveBeenCalledWith(
      server,
      "Mallory",
      expect.stringContaining("already been used"),
    );
  });

  it("rate-limits repeated attempts from the same player through the command cooldown", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({ status: "unknown-code" });
    const { registerLogCommand } = await import("../../src/bot/logWatcher/logWatcher.js");
    const mod = await import("../../src/bot/logWatcher/commands/connection/link.js");
    mod.init();
    const [regex, registered] = vi.mocked(registerLogCommand).mock.calls.at(-1)!;
    const { client } = makeClient("discord-1");
    const server = { id: "main", send: vi.fn().mockResolvedValue({ kind: "delivered", output: "" }) };
    const say = (player: string, code: string) =>
      registered(
        (regex as RegExp).exec(`[12:00:00] [Server thread/INFO]: <${player}> !link ${code}`)!,
        client as never,
        server as never,
      );

    await say("Steve", "AAAA1111");
    await say("Steve", "BBBB2222");
    expect(confirmLinkCode).toHaveBeenCalledTimes(1);
    expect(whisper).toHaveBeenCalledWith(server, "Steve", expect.stringContaining("Please wait"));

    // A different player is not affected by Steve's cooldown.
    await say("Alex", "CCCC3333");
    expect(confirmLinkCode).toHaveBeenCalledTimes(2);

    // After the cooldown window, Steve may try again.
    vi.advanceTimersByTime(3_100);
    await say("Steve", "DDDD4444");
    expect(confirmLinkCode).toHaveBeenCalledTimes(3);
  });

  it("reaches the user through a fetch when the cache does not hold them", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({ status: "expired", discordId: "discord-5" });
    const handler = await loadHandler();
    const { client, send } = makeClient("discord-5");
    await handler("Steve", { code: "EXPIRED1" }, client as never, null as never);
    expect(client.users.fetch).toHaveBeenCalledWith("discord-5");
    expect(send).toHaveBeenCalled();
  });

  it("still links when the user cannot be fetched", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({ status: "linked", discordId: "discord-6" });
    const handler = await loadHandler();
    const { client } = makeClient("discord-6");
    client.users.fetch.mockRejectedValue(new Error("Unknown User"));
    await handler("Steve", { code: "ABCD1234" }, client as never, null as never);
    expect(syncLinkedRole).toHaveBeenCalledWith(client, "discord-6", "add");
  });

  it("survives a store failure without throwing", async () => {
    vi.mocked(confirmLinkCode).mockRejectedValue(new Error("db locked"));
    const handler = await loadHandler();
    const { client, send } = makeClient("discord-1");

    await expect(
      handler("Steve", { code: "AAAA1111" }, client as never, null as never),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
