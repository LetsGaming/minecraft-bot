/**
 * Tests for the shared console sanitization helper and the
 * Unicode-aware filtering it implements.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeForComponent,
  stripControlChars,
  isValidMcName,
} from "../../src/core/utils/sanitize.js";

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

describe("sanitizeForComponent", () => {
  it("strips control characters but leaves quotes for JSON to escape", () => {
    const out = sanitizeForComponent("Bo\nb", 'say "hi"\r\n/op me');
    expect(out).toEqual({ name: "Bob", message: 'say "hi"/op me' });
  });
});
