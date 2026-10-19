/**
 * statusEmbed.test.ts — invalidateStatusChannelCache (exported)
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn(),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createEmbed: vi
    .fn()
    .mockReturnValue({
      type: "base-embed",
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
}));

vi.mock("../../src/bot/utils/guild/discordChannel.js", () => ({
  ensureManagedCategory: vi.fn(),
  ensureTextChannel: vi.fn(),
  ensureVoiceChannel: vi.fn(),
  renameVoiceChannelIfChanged: vi.fn(),
}));

vi.mock("../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/config.js")>()),
  loadConfig: vi.fn().mockReturnValue({ presence: { enabled: false }, guilds: {} }),
}));

import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import {
  invalidateStatusChannelCache,
  sendOrUpdateEmbed,
  startStatusEmbed,
  reconcileStatusEmbed,
} from "../../src/bot/logWatcher/watchers/schedulers/statusEmbed.js";

describe("invalidateStatusChannelCache", () => {
  it("runs without throwing", () => {
    expect(() => invalidateStatusChannelCache()).not.toThrow();
  });

  it("can be called multiple times safely", () => {
    invalidateStatusChannelCache();
    invalidateStatusChannelCache();
    invalidateStatusChannelCache();
    expect(true).toBe(true);
  });
});

describe("startStatusEmbed guild source", () => {
  afterEach(() => {
    reconcileStatusEmbed({} as never, { guilds: {}, presence: { enabled: false } });
  });

  it("does not arm while a provider reports no enabled guild", () => {
    expect(startStatusEmbed({} as never, () => ({}))).toBeNull();
  });

  it("arms from a provider that reports an enabled guild", () => {
    const timer = startStatusEmbed({ user: null, guilds: { cache: new Map() } } as never, () => ({
      g1: { statusEmbed: { enabled: true } },
    }) as never);
    expect(timer).toBeTruthy();
  });
});

describe("sendOrUpdateEmbed (AUD-023)", () => {
  const discordError = (code: number) => Object.assign(new Error(`code ${code}`), { code });
  function channel(fetchError: unknown) {
    const edit = vi.fn();
    return {
      send: vi.fn().mockResolvedValue({ id: "new" }),
      messages: {
        fetch: fetchError
          ? vi.fn().mockRejectedValue(fetchError)
          : vi.fn().mockResolvedValue({ edit }),
      },
      edit,
    };
  }
  beforeEach(() => {
    closeDbForTesting();
    kvSet("statusMessages", { g1: { categoryId: "cat", textChannelId: "c", voiceChannelId: "v", messageId: "old" } });
  });

  it("edits the stored message", async () => {
    const ch = channel(null);
    await sendOrUpdateEmbed(ch as never, {} as never, "g1");
    expect(ch.edit).toHaveBeenCalledOnce();
    expect(ch.send).not.toHaveBeenCalled();
  });

  it("posts a new embed only when the old message is gone", async () => {
    const gone = channel(discordError(10008));
    await sendOrUpdateEmbed(gone as never, {} as never, "g1");
    expect(gone.send).toHaveBeenCalledOnce();
    expect(kvGet<Record<string, { messageId: string }>>("statusMessages")?.["g1"]?.messageId).toBe("new");
  });

  it("does not post a duplicate on a transient error", async () => {
    for (const err of [discordError(0), Object.assign(new Error("503"), { status: 503 })]) {
      const ch = channel(err);
      await sendOrUpdateEmbed(ch as never, {} as never, "g1");
      expect(ch.send).not.toHaveBeenCalled();
    }
  });

  it("does not post into a channel that no longer exists", async () => {
    const ch = channel(discordError(10003));
    await sendOrUpdateEmbed(ch as never, {} as never, "g1");
    expect(ch.send).not.toHaveBeenCalled();
  });
});
