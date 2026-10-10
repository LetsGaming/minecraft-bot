/**
 * Discord rejects whole payloads when a string exceeds its field limit, so
 * every locale string that reaches a limited field is checked in both
 * languages. Keys are discovered from the call sites under src/bot.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "../../src/core/locales/en.js";
import { de } from "../../src/core/locales/de.js";

const BOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "bot");

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? listSources(full)
      : full.endsWith(".ts")
        ? [full]
        : [];
  });
}

const LIMITS = {
  modalTitle: 45,
  modalLabel: 45,
  buttonLabel: 80,
  placeholder: 100,
  selectOption: 100,
  embedTitle: 256,
} as const;

type LimitKind = keyof typeof LIMITS;

function collectKeys(): Map<string, LimitKind> {
  const found = new Map<string, LimitKind>();
  const add = (key: string, kind: LimitKind): void => {
    const prev = found.get(key);
    if (!prev || LIMITS[kind] < LIMITS[prev]) found.set(key, kind);
  };
  for (const file of listSources(BOT_DIR)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\.setTitle\(\s*t\(\s*"([^"]+)"/g))
      add(m[1]!, "modalTitle");
    for (const m of src.matchAll(/\.setLabel\(\s*t\(\s*"([^"]+)"/g))
      add(m[1]!, /modal/i.test(m[1]!) ? "modalLabel" : "buttonLabel");
    for (const m of src.matchAll(/\.setPlaceholder\(\s*t\(\s*"([^"]+)"/g))
      add(m[1]!, "placeholder");
    for (const m of src.matchAll(/\blabel:\s*t\(\s*"([^"]+)"/g))
      add(m[1]!, "selectOption");
    for (const m of src.matchAll(/\btitle:\s*t\(\s*"([^"]+)"/g))
      add(m[1]!, "embedTitle");
  }
  return found;
}

describe("locale strings respect Discord field limits", () => {
  const keys = collectKeys();

  it("finds the known call sites", () => {
    expect(keys.get("wlapp.modalNote")).toBe("modalLabel");
    expect(keys.get("wlapp.modalTitle")).toBe("modalTitle");
    expect(keys.get("wlapp.applyButton")).toBe("buttonLabel");
    expect(keys.size).toBeGreaterThan(20);
  });

  for (const [lang, table] of [
    ["en", en],
    ["de", de],
  ] as const) {
    it(`${lang}: every limited string fits`, () => {
      const violations: string[] = [];
      for (const [key, kind] of keys) {
        const value = table[key];
        if (value === undefined) continue;
        const len = [...value].length;
        if (len > LIMITS[kind])
          violations.push(`${key} (${kind}): ${len} > ${LIMITS[kind]}`);
      }
      expect(violations).toEqual([]);
    });
  }
});
