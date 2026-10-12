import { describe, it, expect } from "vitest";
import {
  ServerState,
  ConfigApplyState,
  StatusRole,
  STATUS_ROLES,
  STATUS_TABLE,
  SERVER_STATE_ROLE,
  CONFIG_APPLY_STATE_ROLE,
  statusRole,
  statusColor,
  statusShape,
  statusEmbedColor,
  statusLabelKey,
  GLOSSARY,
  glossaryText,
  statusRoleGlossaryKey,
} from "@mcbot/schema";

describe("status table", () => {
  it("defines exactly the seven roles", () => {
    expect([...STATUS_ROLES].sort()).toEqual([
      "applied",
      "degraded",
      "info",
      "offline",
      "online",
      "pending",
      "unknown",
    ]);
    for (const role of STATUS_ROLES) expect(STATUS_TABLE[role].name).toBe(role);
  });

  it("gives every role its own shape", () => {
    const shapes = STATUS_ROLES.map((r) => statusShape(r));
    expect(new Set(shapes).size).toBe(STATUS_ROLES.length);
  });

  it("uses hex colours and an embed colour equal to the foreground", () => {
    for (const role of STATUS_ROLES) {
      const def = STATUS_TABLE[role];
      expect(def.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(def.tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(def.embedColour).toBe(parseInt(def.colour.slice(1), 16));
    }
  });

  it("has a glossary label for every role", () => {
    for (const role of STATUS_ROLES) {
      expect(statusLabelKey(role)).toBe(statusRoleGlossaryKey(role));
      expect(GLOSSARY).toHaveProperty(statusLabelKey(role));
    }
  });
});

describe("state mappings", () => {
  it("maps every ServerState", () => {
    expect(Object.keys(SERVER_STATE_ROLE).sort()).toEqual(Object.values(ServerState).sort());
    expect(statusRole(ServerState.Online)).toBe(StatusRole.Online);
    expect(statusRole(ServerState.Unresponsive)).toBe(StatusRole.Degraded);
    expect(statusRole(ServerState.Offline)).toBe(StatusRole.Offline);
    expect(statusRole(ServerState.Unknown)).toBe(StatusRole.Unknown);
  });

  it("maps every ConfigApplyState", () => {
    expect(Object.keys(CONFIG_APPLY_STATE_ROLE).sort()).toEqual(
      Object.values(ConfigApplyState).sort(),
    );
    expect(statusRole(ConfigApplyState.Applied)).toBe(StatusRole.Applied);
    expect(statusRole(ConfigApplyState.Pending)).toBe(StatusRole.Pending);
    expect(statusRole(ConfigApplyState.BotDown)).toBe(StatusRole.Offline);
    expect(statusRole(ConfigApplyState.RestartRequired)).toBe(StatusRole.Pending);
    expect(statusRole(ConfigApplyState.Unknown)).toBe(StatusRole.Unknown);
  });

  it("resolves colours and shapes through the mapping", () => {
    expect(statusColor(ServerState.Unresponsive)).toBe("#fbbf24");
    expect(statusShape(ServerState.Unresponsive)).toBe("diamond");
    expect(statusEmbedColor(ConfigApplyState.BotDown)).toBe(0xf87171);
  });

  it("falls back to unknown for an unrecognised state", () => {
    expect(statusRole("nonsense" as ServerState)).toBe(StatusRole.Unknown);
  });
});

describe("glossary", () => {
  it("has English and German text for every entry", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.en, key).not.toBe("");
      expect(entry.de, key).not.toBe("");
    }
  });

  it("looks terms up by language", () => {
    expect(glossaryText("term.guild")).toBe("Guild");
    expect(glossaryText("term.guild", "de")).toBe("Discord-Server");
  });
});

describe("backupTierLabel", () => {
  it("labels wrapper tier directories in both languages", async () => {
    const { backupTierLabel } = await import("../../src/schema/glossary.js");
    expect(backupTierLabel("hourly")).toBe("Hourly");
    expect(backupTierLabel("archives/update")).toBe("Pre-update");
    expect(backupTierLabel("archives/daily", "de")).toBe("Täglich");
    expect(backupTierLabel("archives/custom")).toBe("Custom");
  });
});
