import { describe, it, expect } from "vitest";
import {
  CUSTOM_ID_MAX_LENGTH,
  joinCustomId,
} from "../../src/bot/utils/embeds/customId.js";
import { confirmCustomId, parseConfirmCustomId } from "../../src/bot/utils/embeds/confirm.js";

describe("joinCustomId", () => {
  it("joins the parts with a colon", () => {
    expect(joinCustomId("hint", "yes", "daily-reminder", "smp", "123")).toBe(
      "hint:yes:daily-reminder:smp:123",
    );
  });

  it("rejects a part that would shift the parsed fields", () => {
    expect(() => joinCustomId("hint", "yes", "a", "my:server", "1")).toThrow(/":"/);
  });

  it("rejects an id Discord would refuse", () => {
    expect(() => joinCustomId("x", "y".repeat(CUSTOM_ID_MAX_LENGTH))).toThrow(/100/);
    expect(joinCustomId("x", "y".repeat(CUSTOM_ID_MAX_LENGTH - 2))).toHaveLength(CUSTOM_ID_MAX_LENGTH);
  });
});

describe("confirmCustomId", () => {
  const target = { action: "server-stop", serverId: "smp", userId: "123", expiresAt: 1_700_000_000_000 };

  it("round-trips through the parser", () => {
    expect(parseConfirmCustomId(confirmCustomId("yes", target))).toEqual({ ...target, answer: "yes" });
  });

  it("refuses a server id containing a colon", () => {
    expect(() => confirmCustomId("yes", { ...target, serverId: "a:b" })).toThrow();
  });
});
