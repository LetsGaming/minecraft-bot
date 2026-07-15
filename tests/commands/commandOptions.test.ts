/**
 * Command options (the url → options change): the per-command option registry
 * and config validation of the new commands.<name>.options block.
 */
import { describe, it, expect } from "vitest";
import { COMMAND_OPTIONS, commandOptionSpecs } from "../../src/schema/commandOptions.js";
import { validateCandidateConfig } from "../../src/core/config.js";

const base = { token: "t", clientId: "c" };

describe("command option registry", () => {
  it("declares /map's URL option with a type + label", () => {
    const specs = commandOptionSpecs("map");
    expect(specs.map((s) => s.key)).toContain("url");
    const url = specs.find((s) => s.key === "url")!;
    expect(url.type).toBe("string");
    expect(url.label).toBeTruthy();
  });

  it("returns an empty list for a command with no options", () => {
    expect(commandOptionSpecs("nonexistent-command")).toEqual([]);
  });

  it("exposes the registry as a plain map", () => {
    expect(COMMAND_OPTIONS.map).toBeDefined();
  });
});

describe("config validation — command options", () => {
  it("accepts an options block of scalars", () => {
    const cfg = {
      ...base,
      commands: { map: { options: { url: "https://map.example.com" } } },
    };
    expect(validateCandidateConfig(cfg).valid).toBe(true);
  });

  it("accepts string, number, and boolean option values", () => {
    const cfg = {
      ...base,
      commands: { map: { options: { url: "x", limit: 5, flag: true } } },
    };
    expect(validateCandidateConfig(cfg).valid).toBe(true);
  });

  it("rejects a non-scalar option value with a specific message", () => {
    const cfg = {
      ...base,
      commands: { map: { options: { url: { nested: "no" } } } },
    };
    const result = validateCandidateConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("options.url"))).toBe(true);
  });

  it("rejects options that isn't an object", () => {
    const cfg = { ...base, commands: { map: { options: "nope" } } };
    const result = validateCandidateConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(".options"))).toBe(true);
  });

  it("still accepts the legacy `url` field (ignored, not rejected)", () => {
    // Back-compat: old configs stored the URL directly; validation must not
    // break them (the map command reads it via a fallback).
    const cfg = { ...base, commands: { map: { url: "https://old.example.com" } } };
    expect(validateCandidateConfig(cfg).valid).toBe(true);
  });
});
