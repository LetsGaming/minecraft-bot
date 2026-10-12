import { describe, it, expect } from "vitest";
import { ApiError } from "../../src/web/frontend/src/api.js";
import { describeDiscordFailure, discordFailureKind } from "../../src/web/frontend/src/utils/discordFailure.js";

const fallback = { title: "Could not load", recovery: "Try again." };

describe("discordFailureKind", () => {
  it("reads the error code, not the message", () => {
    expect(discordFailureKind(new ApiError(503, "(401)", "DISCORD_TOKEN_MISSING"))).toBe("token-missing");
    expect(discordFailureKind(new ApiError(502, "anything", "DISCORD_TOKEN_REJECTED"))).toBe("token-rejected");
    expect(discordFailureKind(new ApiError(502, "Discord API error (401).", "BAD_GATEWAY"))).toBe("unreachable");
    expect(discordFailureKind(new ApiError(429, "slow", "RATE_LIMITED"))).toBe("rate-limited");
    expect(discordFailureKind(new ApiError(403, "no", "FORBIDDEN"))).toBe("forbidden");
    expect(discordFailureKind(new ApiError(500, "Internal server error"))).toBe("other");
    expect(discordFailureKind(new Error("offline"))).toBe("other");
  });
});

describe("describeDiscordFailure", () => {
  it("sends a sysadmin to Config and anyone else to a bot admin", () => {
    const err = new ApiError(502, "Couldn't reach Discord", "DISCORD_TOKEN_REJECTED");
    const admin = describeDiscordFailure(err, true, fallback);
    expect(admin.title).toBe("Discord rejected the bot token");
    expect(admin.fixInConfig).toBe(true);
    expect(admin.detail).toBe("HTTP 502: Couldn't reach Discord");
    const manager = describeDiscordFailure(err, false, fallback);
    expect(manager.recovery).toMatch(/^Ask a bot admin/);
    expect(manager.fixInConfig).toBe(false);
  });

  it("falls back to the caller's copy for failures that are not Discord's", () => {
    const copy = describeDiscordFailure(new ApiError(500, "Internal server error"), true, fallback);
    expect(copy.title).toBe("Could not load");
    expect(copy.recovery).toBe("Try again.");
    expect(copy.fixInConfig).toBe(false);
  });
});
