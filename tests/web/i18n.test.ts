import { describe, it, expect } from "vitest";
import { createTranslator, statusLabel, t } from "../../src/web/frontend/src/i18n.js";

describe("dashboard t()", () => {
  it("reads shell copy and fills placeholders", () => {
    expect(t("nav.audit")).toBe("Audit log");
    expect(t("shell.signedInAs", { name: "domenic" })).toBe("Signed in as domenic");
  });

  it("reads shared terms and status labels from the glossary", () => {
    expect(t("term.server")).toBe("Server");
    expect(statusLabel("degraded")).toBe("Not responding");
  });

  it("picks the plural variant by count", () => {
    const tr = createTranslator(
      { "mods.count.one": "{count} mod", "mods.count.other": "{count} mods" },
      "en",
    );
    expect(tr("mods.count", { count: 1 })).toBe("1 mod");
    expect(tr("mods.count", { count: 3 })).toBe("3 mods");
  });

  it("leaves unknown placeholders and keys visible instead of blank", () => {
    const tr = createTranslator({ greet: "Hi {name}" }, "en");
    expect(tr("greet", {})).toBe("Hi {name}");
    expect(tr("missing.key")).toBe("missing.key");
  });
});
