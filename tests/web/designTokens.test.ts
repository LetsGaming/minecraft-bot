import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STATUS_ROLES, STATUS_TABLE } from "@mcbot/schema";
import { statusTokens } from "../../src/web/frontend/src/statusTokens";

const srcDir = resolve(__dirname, "../../src/web/frontend/src");
const tokensCss = readFileSync(resolve(srcDir, "tokens.css"), "utf8");
const styleCss = readFileSync(resolve(srcDir, "style.css"), "utf8");

describe("status role tokens", () => {
  it("writes a foreground and a tint for every role from the shared table", () => {
    const tokens = statusTokens();
    expect(Object.keys(tokens)).toHaveLength(STATUS_ROLES.length * 2);
    for (const role of STATUS_ROLES) {
      expect(tokens[`--st-${role}`]).toBe(STATUS_TABLE[role].colour);
      expect(tokens[`--st-${role}-bg`]).toBe(STATUS_TABLE[role].tint);
    }
  });

  it("keeps the status roles out of tokens.css so the table stays the only source", () => {
    expect(tokensCss).not.toMatch(/--st-[a-z]+(-bg)?:/);
  });
});

describe("token files", () => {
  it("defines every var() the legacy aliases in style.css point at", () => {
    const defined = new Set([...tokensCss.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
    for (const role of STATUS_ROLES) defined.add(`--st-${role}`);
    const aliasTargets = [...styleCss.matchAll(/--mc-[\w-]+: var\((--[\w-]+)\)/g)].map((m) => m[1]!);
    expect(aliasTargets.length).toBeGreaterThan(0);
    for (const target of aliasTargets) expect(defined, target).toContain(target);
  });
});

describe("useDensity", () => {
  const store = new Map<string, string>();
  const root = { dataset: {} as Record<string, string> };

  beforeEach(() => {
    store.clear();
    root.dataset = {};
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("document", { documentElement: root, createElement: () => ({}) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to comfortable and applies it to the document", async () => {
    const { initDensity, useDensity } = await import("../../src/web/frontend/src/composables/useDensity");
    initDensity();
    expect(useDensity().density.value).toBe("comfortable");
    expect(root.dataset.density).toBe("comfortable");
  });

  it("persists the choice and restores it on the next load", async () => {
    const first = await import("../../src/web/frontend/src/composables/useDensity");
    first.useDensity().toggleDensity();
    expect(root.dataset.density).toBe("compact");

    vi.resetModules();
    root.dataset = {};
    const second = await import("../../src/web/frontend/src/composables/useDensity");
    second.initDensity();
    expect(second.useDensity().density.value).toBe("compact");
    expect(root.dataset.density).toBe("compact");
  });

  it("ignores an unknown stored value", async () => {
    store.set("mcbot.density.v1", "huge");
    const { initDensity, useDensity } = await import("../../src/web/frontend/src/composables/useDensity");
    initDensity();
    expect(useDensity().density.value).toBe("comfortable");
  });

  it("still works when storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { initDensity, useDensity } = await import("../../src/web/frontend/src/composables/useDensity");
    initDensity();
    useDensity().setDensity("compact");
    expect(useDensity().density.value).toBe("compact");
  });
});
