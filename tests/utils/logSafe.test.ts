import { describe, it, expect } from "vitest";

import { logFields, logSafe } from "../../src/core/utils/logSafe.js";
import { parseReleaseVersions } from "../../src/core/utils/minecraft/mojang.js";

const c = (...codes: number[]) => String.fromCharCode(...codes);

const CLASSES: Record<string, string> = {
  LF: c(10),
  CR: c(13),
  VT: c(11),
  FF: c(12),
  NUL: c(0),
  ESC: c(27),
  DEL: c(0x7f),
  NEL: c(0x85),
  LS: c(0x2028),
  PS: c(0x2029),
  "bidi override": c(0x202e),
  "bidi isolate": c(0x2066),
  "zero width": c(0x200b),
  "ANSI CSI": c(27) + "[31mred" + c(27) + "[0m",
  OSC: c(27) + "]0;title" + c(7),
};

function physicalLines(text: string): number {
  const breaks = new Set([10, 13, 11, 12, 0x85, 0x2028, 0x2029]);
  let n = 1;
  for (const ch of text) if (breaks.has(ch.charCodeAt(0))) n++;
  return n;
}

describe("logSafe", () => {
  it.each(Object.entries(CLASSES))("neutralises %s", (_n, ch) => {
    const out = logSafe("a" + ch + "b key=forged");
    expect(physicalLines(out)).toBe(1);
    expect(out).not.toContain(ch);
    expect(out.startsWith("a")).toBe(true);
  });

  it("keeps ordinary text readable and caps length", () => {
    expect(logSafe("Sodium 0.5.8 für 1.21.5")).toBe("Sodium 0.5.8 für 1.21.5");
    expect(logSafe("a".repeat(2000)).length).toBeLessThan(600);
  });
});

describe("logFields", () => {
  it("leaves plain values bare", () => {
    expect(logFields({ server: "smp", mcVersion: "1.21.5" })).toBe("server=smp mcVersion=1.21.5");
  });

  it("quotes a hostile value so it cannot add a pair", () => {
    const out = logFields({ detail: 'x" job=forged ' + c(10) + "next", server: "smp" });
    expect(physicalLines(out)).toBe(1);
    const pairs = [...out.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S*)/g)].map((m) => m[1]);
    expect(pairs).toEqual(["detail", "server"]);
  });
});

describe("parseReleaseVersions", () => {
  it("keeps release ids in manifest order and drops everything else", () => {
    const raw = {
      versions: [
        { id: "24w01a", type: "snapshot" },
        { id: "1.21.5", type: "release" },
        { id: 7, type: "release" },
        null,
        { id: "1.21.4", type: "release" },
      ],
    };
    expect(parseReleaseVersions(raw)).toEqual(["1.21.5", "1.21.4"]);
    expect(parseReleaseVersions({})).toEqual([]);
    expect(parseReleaseVersions(null)).toEqual([]);
  });
});
