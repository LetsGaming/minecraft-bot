import { describe, it, expect, vi } from "vitest";

const mockKnownPlayerUuid = vi.fn<(name: string) => string | null>();

vi.mock("@mcbot/core/utils/minecraft/whitelist.js", () => ({
  knownPlayerUuid: (name: string) => mockKnownPlayerUuid(name),
}));

import { playerAvatarUrl } from "../../src/bot/utils/mcHeads.js";

describe("playerAvatarUrl", () => {
  it("uses the cached UUID when the player is known", () => {
    mockKnownPlayerUuid.mockReturnValue("069a79f444e94726a5befca90e38aaf5");
    expect(playerAvatarUrl("Notch")).toBe(
      "https://mc-heads.net/avatar/069a79f444e94726a5befca90e38aaf5/64",
    );
  });

  it("falls back to the raw (encoded) name when no UUID is cached", () => {
    mockKnownPlayerUuid.mockReturnValue(null);
    expect(playerAvatarUrl("Some Name")).toBe(
      "https://mc-heads.net/avatar/Some%20Name/64",
    );
  });

  it("looks the name up case-insensitively via the cache", () => {
    mockKnownPlayerUuid.mockReturnValue("abc123");
    playerAvatarUrl("NOTCH");
    expect(mockKnownPlayerUuid).toHaveBeenCalledWith("NOTCH");
  });
});
