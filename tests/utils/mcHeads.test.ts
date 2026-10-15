import { describe, it, expect } from "vitest";

import { playerAvatarUrl } from "../../src/bot/utils/mcHeads.js";

describe("playerAvatarUrl", () => {
  it("draws a head from the player's name", () => {
    expect(playerAvatarUrl("BangBoomBang19")).toBe("https://mc-heads.net/avatar/BangBoomBang19/64");
  });

  it("encodes the name", () => {
    expect(playerAvatarUrl("Some Name")).toBe("https://mc-heads.net/avatar/Some%20Name/64");
  });

});
