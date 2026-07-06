/**
 * statusEmbed.test.ts — invalidateStatusChannelCache (exported)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/core/utils/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn(),
}));

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createEmbed: vi
    .fn()
    .mockReturnValue({
      type: "base-embed",
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
}));

vi.mock("../src/bot/utils/discordChannel.js", () => ({
  ensureManagedCategory: vi.fn(),
  ensureTextChannel: vi.fn(),
  ensureVoiceChannel: vi.fn(),
  renameVoiceChannelIfChanged: vi.fn(),
}));

import { invalidateStatusChannelCache } from "../src/bot/logWatcher/watchers/statusEmbed.js";

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
