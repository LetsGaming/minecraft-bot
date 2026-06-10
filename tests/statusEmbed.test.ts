/**
 * statusEmbed.test.ts — invalidateStatusChannelCache (exported)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/utils/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn(),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi
    .fn()
    .mockReturnValue({
      type: "base-embed",
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
}));

vi.mock("../src/utils/discordChannel.js", () => ({
  ensureManagedCategory: vi.fn(),
  ensureTextChannel: vi.fn(),
  ensureVoiceChannel: vi.fn(),
  renameVoiceChannelIfChanged: vi.fn(),
}));

import { invalidateStatusChannelCache } from "../src/logWatcher/watchers/statusEmbed.js";

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
