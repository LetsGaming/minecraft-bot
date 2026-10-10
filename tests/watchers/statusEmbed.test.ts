/**
 * statusEmbed.test.ts — invalidateStatusChannelCache (exported)
 */
import { describe, it, expect, vi, afterEach } from "vitest";

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

import {
  invalidateStatusChannelCache,
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
