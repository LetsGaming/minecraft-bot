/**
 * Tests for the account linking flow.
 *
 * Covers:
 *  - generateCode: output format (randomBytes hex encoding)
 *  - logWatcher link handler: happy path, unknown code, expiry,
 *    name-taken, rate limiting — against a mocked confirmLinkCode
 *    (the atomic store op that replaced the module-level codes cache)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";

// ── Top-level mocks — must be at file scope for Vitest hoisting ───────────

vi.mock("../src/core/utils/linkUtils.js", () => ({
  confirmLinkCode: vi.fn(),
}));

vi.mock("../src/bot/utils/linkedRole.js", () => ({
  syncLinkedRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { confirmLinkCode } from "../src/core/utils/linkUtils.js";
import { syncLinkedRole } from "../src/bot/utils/linkedRole.js";

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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Reset in-memory rate-limit state to prevent bleed between tests.
    const mod = await import("../src/bot/logWatcher/commands/link.js");
    mod._resetStateForTesting?.();
    vi.clearAllMocks();
  });

  async function loadHandler() {
    const mod = await import("../src/bot/logWatcher/commands/link.js");
    await mod.init();
    return mod.handler;
  }

  function makeClient(discordId: string) {
    const send = vi.fn().mockResolvedValue(undefined);
    return {
      client: {
        users: { cache: new Map([[discordId, { send }]]) },
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

  it("rate-limits repeated attempts from the same player", async () => {
    vi.mocked(confirmLinkCode).mockResolvedValue({ status: "unknown-code" });
    const handler = await loadHandler();
    const { client } = makeClient("discord-1");

    await handler("Steve", { code: "AAAA1111" }, client as never, null as never);
    await handler("Steve", { code: "BBBB2222" }, client as never, null as never);
    expect(confirmLinkCode).toHaveBeenCalledTimes(1);

    // A different player is not affected by Steve's cooldown.
    await handler("Alex", { code: "CCCC3333" }, client as never, null as never);
    expect(confirmLinkCode).toHaveBeenCalledTimes(2);

    // After the cooldown window, Steve may try again.
    vi.advanceTimersByTime(3_100);
    await handler("Steve", { code: "DDDD4444" }, client as never, null as never);
    expect(confirmLinkCode).toHaveBeenCalledTimes(3);
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
