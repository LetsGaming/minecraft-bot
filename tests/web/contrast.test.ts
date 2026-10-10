import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../src/web/frontend/src");
const css = readFileSync(resolve(root, "style.css"), "utf8");
const preset = readFileSync(resolve(root, "main.ts"), "utf8");

function cssVar(name: string): string {
  const m = new RegExp(`${name}: *(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1]!;
}

function presetValue(key: string): string {
  const m = new RegExp(`${key}: *"(#[0-9a-fA-F]{6})"`).exec(preset);
  if (!m) throw new Error(`preset value ${key} not found`);
  return m[1]!;
}

function presetAccent(): string {
  const m = /primary:\s*\{\s*color:\s*"(#[0-9a-fA-F]{6})"/.exec(preset);
  if (!m) throw new Error("preset primary.color not found");
  return m[1]!;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("dashboard colour tokens", () => {
  const surfaces = ["--mc-bg", "--mc-surface", "--mc-card"].map(cssVar);

  it("primary button text is AAA on the accent fill", () => {
    expect(ratio(presetValue("contrastColor"), presetAccent())).toBeGreaterThanOrEqual(7);
    expect(ratio(cssVar("--mc-on-accent"), cssVar("--mc-accent"))).toBeGreaterThanOrEqual(7);
  });

  it("the preset and the stylesheet agree on the accent text colour", () => {
    expect(presetValue("contrastColor")).toBe(cssVar("--mc-on-accent"));
  });

  it.each(["--mc-text", "--mc-muted", "--mc-dim"])("%s reads as body text on every surface", (token) => {
    for (const surface of surfaces) {
      expect(ratio(cssVar(token), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the preset muted text matches the dim token", () => {
    expect(presetValue("mutedColor")).toBe(cssVar("--mc-dim"));
  });

  it("the focus ring clears the 3:1 non-text minimum on every surface", () => {
    for (const surface of surfaces) {
      expect(ratio(cssVar("--mc-focus"), surface)).toBeGreaterThanOrEqual(3);
    }
  });
});
