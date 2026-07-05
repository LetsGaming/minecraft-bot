/**
 * Tests for the shared console sanitization helper and the
 * Unicode-aware filtering it implements.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeForConsole,
  stripControlChars,
  isValidMcName,
} from "../src/common/utils/sanitize.js";

describe("stripControlChars", () => {
  it("removes \\r and \\n (console command injection vector)", () => {
    expect(stripControlChars("hello\r\n/stop")).toBe("hello/stop");
  });

  it("removes other control characters", () => {
    expect(stripControlChars("a\u0000b\u001bc\u200bd")).toBe("abcd");
  });

  it("keeps umlauts, accents, and emoji", () => {
    expect(stripControlChars("Grüße, Müller! Ça va? 🎉")).toBe(
      "Grüße, Müller! Ça va? 🎉",
    );
  });
});

describe("sanitizeForConsole", () => {
  it("strips newlines from both name and message", () => {
    const { name, message } = sanitizeForConsole(
      "Evil\r\nName",
      "hi\r\n/op Evil",
    );
    expect(name).toBe("EvilName");
    expect(message).toBe("hi/op Evil");
  });

  it("preserves non-ASCII text in messages", () => {
    const { message } = sanitizeForConsole("Müller", "Grüße an alle 🎮");
    expect(message).toBe("Grüße an alle 🎮");
  });

  it("escapes double quotes in the message", () => {
    const { message } = sanitizeForConsole("A", 'say "hi"');
    expect(message).toBe('say \\"hi\\"');
  });

  it("caps name at 32 and message at 160 characters", () => {
    const { name, message } = sanitizeForConsole(
      "x".repeat(100),
      "y".repeat(500),
    );
    expect(name).toHaveLength(32);
    expect(message).toHaveLength(160);
  });
});

describe("isValidMcName", () => {
  it("accepts vanilla Java names", () => {
    expect(isValidMcName("Steve")).toBe(true);
    expect(isValidMcName("Player_123")).toBe(true);
  });

  it("accepts Bedrock-prefixed names (Geyser/Floodgate)", () => {
    expect(isValidMcName(".BedrockPlayer")).toBe(true);
  });

  it("rejects names with whitespace, newlines, or command characters", () => {
    expect(isValidMcName("bad name")).toBe(false);
    expect(isValidMcName("a\nb")).toBe(false);
    expect(isValidMcName("x; /stop")).toBe(false);
    expect(isValidMcName("a/b")).toBe(false);
  });

  it("rejects empty and over-long names", () => {
    expect(isValidMcName("")).toBe(false);
    expect(isValidMcName("x".repeat(18))).toBe(false);
  });
});
