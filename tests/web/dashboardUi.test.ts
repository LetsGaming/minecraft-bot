import { describe, it, expect } from "vitest";
import { logLevel, lineMatches } from "../../src/web/frontend/src/utils/logLine.js";
import { disambiguateLabels } from "../../src/web/frontend/src/utils/fieldLabels.js";
import { mergeDisks, tierLabel } from "../../src/web/frontend/src/utils/format.js";
import { humaniseIds } from "../../src/web/frontend/src/utils/humaniseIds.js";
import { isActionApplicable } from "../../src/schema/serverActions.js";
import { playersLabel } from "../../src/web/frontend/src/utils/format.js";
import { isPlayerOnline } from "../../src/core/utils/minecraft/playerUtils.js";
import {
  stateIsUp,
  serverIsUp,
  type ServerHealth,
} from "../../src/schema/serverState.js";
import { ServerState } from "../../src/schema/serverState.js";

describe("logLevel", () => {
  it("reads the level out of the thread bracket", () => {
    expect(logLevel("[22:23:30] [Server thread/WARN]: Can't keep up!")).toBe("warn");
    expect(logLevel("[22:23:27] [Server thread/INFO]: Dom joined the game")).toBe("info");
    expect(logLevel("[22:23:27] [main/ERROR]: Failed to load mod")).toBe("error");
  });

  it("folds the logger taxonomy into the three weights the pane renders", () => {
    expect(logLevel("[x/FATAL]: gone")).toBe("error");
    expect(logLevel("[x/SEVERE]: gone")).toBe("error");
    expect(logLevel("[x/WARNING]: hmm")).toBe("warn");
    expect(logLevel("[x/DEBUG]: noise")).toBe("info");
  });

  it("does not colour by keyword-anywhere", () => {
    // A chat line quoting the word must not render as an error, which is what
    // a naive /error/i test over the whole line would have done.
    expect(logLevel("[22:24:36] [Server thread/INFO]: <Dom> that error was mine")).toBe("info");
  });
});

describe("lineMatches", () => {
  const warn = "[22:23:30] [Server thread/WARN]: Can't keep up!";
  const info = "[22:23:27] [Server thread/INFO]: Dom joined the game";

  it("treats the level as a floor, not an equality test", () => {
    expect(lineMatches(warn, { minLevel: "warn" })).toBe(true);
    expect(lineMatches(info, { minLevel: "warn" })).toBe(false);
    expect(lineMatches(warn, { minLevel: "info" })).toBe(true);
  });

  it("combines the level floor with the text query", () => {
    expect(lineMatches(info, { query: "joined" })).toBe(true);
    expect(lineMatches(info, { query: "left" })).toBe(false);
    expect(lineMatches(info, { minLevel: "error", query: "joined" })).toBe(false);
  });
});

describe("disambiguateLabels", () => {
  it("qualifies only the labels that actually collide", () => {
    const out = disambiguateLabels([
      { label: "Enabled", path: ["enabled"] },
      { label: "Enabled", path: ["overworld", "enabled"] },
      { label: "Engine mode", path: ["overworld", "engineMode"] },
    ]);
    // The root field keeps the bare name; the nested one gets its parent.
    expect(out[0]!.displayLabel).toBe("Enabled");
    expect(out[1]!.displayLabel).toBe("Overworld: Enabled");
    // A label that was already unique is left exactly as the parser made it.
    expect(out[2]!.displayLabel).toBe("Engine mode");
  });

  it("humanises the qualifying segment", () => {
    const out = disambiguateLabels([
      { label: "Enabled", path: ["the_nether", "enabled"] },
      { label: "Enabled", path: ["endDimension", "enabled"] },
    ]);
    expect(out[0]!.displayLabel).toBe("The nether: Enabled");
    expect(out[1]!.displayLabel).toBe("End Dimension: Enabled");
  });
});

describe("mergeDisks", () => {
  it("collapses two paths on one volume into a single row", () => {
    // Regression: the server card printed "Server disk 42.6 GB / 119.0 GB"
    // and "Backups disk 42.6 GB / 119.0 GB" side by side.
    const merged = mergeDisks([
      { path: "/srv/minecraft/instance", usedBytes: 42_600, totalBytes: 119_000, usedPercent: 33 },
      { path: "/srv/minecraft/backups", usedBytes: 42_600, totalBytes: 119_000, usedPercent: 33 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.paths).toHaveLength(2);
    expect(merged[0]!.label.toLowerCase()).toContain("backups");
  });

  it("keeps genuinely separate volumes separate", () => {
    const merged = mergeDisks([
      { path: "/srv/minecraft/instance", usedBytes: 42_600, totalBytes: 119_000, usedPercent: 33 },
      { path: "/mnt/backups", usedBytes: 900_000, totalBytes: 2_000_000, usedPercent: 45 },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("tierLabel", () => {
  it("names the retention tier instead of echoing its storage path", () => {
    expect(tierLabel("hourly")).toBe("Hourly");
    expect(tierLabel("archives/daily")).toBe("Daily");
    expect(tierLabel("archives/update")).toBe("Pre-update");
    // An unknown tier is still shown, just tidied.
    expect(tierLabel("archives/preflight")).toBe("Preflight");
  });
});

describe("isActionApplicable", () => {
  it("does not offer Start on a running server", () => {
    expect(isActionApplicable("start", ServerState.Online)).toBe(false);
    expect(isActionApplicable("start", ServerState.Unresponsive)).toBe(false);
    expect(isActionApplicable("start", ServerState.Offline)).toBe(true);
  });

  it("does not offer Stop or Restart on a stopped server", () => {
    expect(isActionApplicable("stop", ServerState.Offline)).toBe(false);
    expect(isActionApplicable("restart", ServerState.Offline)).toBe(false);
    expect(isActionApplicable("stop", ServerState.Online)).toBe(true);
  });

  it("still offers a server that is up but not answering its controls", () => {
    // Unresponsive is the state where someone most needs Restart.
    expect(isActionApplicable("restart", ServerState.Unresponsive)).toBe(true);
  });

  it("offers everything when the state could not be established", () => {
    // Disabling controls on ignorance hides the buttons an outage needs.
    for (const action of ["start", "stop", "restart", "rollback", "backup"] as const) {
      expect(isActionApplicable(action, ServerState.Unknown)).toBe(true);
    }
  });

  it("keeps the world-file actions available either way", () => {
    expect(isActionApplicable("backup", ServerState.Online)).toBe(true);
    expect(isActionApplicable("rollback", ServerState.Offline)).toBe(true);
  });
});

describe("humaniseIds", () => {
  const names: Record<string, string> = { "1414963283685019781": "Data Corner" };
  const resolve = (id: string): string | undefined => names[id];

  it("replaces snowflakes it can resolve", () => {
    expect(humaniseIds("guild config write (1414963283685019781)", resolve)).toBe(
      "guild config write (Data Corner)",
    );
  });

  it("leaves an unknown ID alone rather than blanking it", () => {
    // Substituting a placeholder would destroy the only identifier the line
    // carried without supplying a real name in return.
    const line = "guild config write (745014801172004874)";
    expect(humaniseIds(line, resolve)).toBe(line);
  });

  it("does not eat numbers that are not snowflakes", () => {
    expect(humaniseIds("purged 1200 messages in 45 s", resolve)).toBe(
      "purged 1200 messages in 45 s",
    );
  });

  it("handles several IDs in one line", () => {
    expect(
      humaniseIds("moved 1414963283685019781 → 745014801172004874", resolve),
    ).toBe("moved Data Corner → 745014801172004874");
  });
});

describe("stateIsUp", () => {
  it("counts an unresponsive server as up, matching the bot", () => {
    // The dashboard gated on the DTO's `online` flag (state === "online"),
    // so an unresponsive server showed as down with no player count while
    // the bot reported it up. Both sides now call this.
    expect(stateIsUp(ServerState.Online)).toBe(true);
    expect(stateIsUp(ServerState.Unresponsive)).toBe(true);
    expect(stateIsUp(ServerState.Offline)).toBe(false);
    expect(stateIsUp(ServerState.Unknown)).toBe(false);
  });

  it("agrees with serverIsUp on every state", () => {
    for (const state of Object.values(ServerState)) {
      expect(stateIsUp(state)).toBe(serverIsUp({ state } as ServerHealth));
    }
  });
});

describe("playersLabel", () => {
  it("distinguishes an empty server from an unknown one", () => {
    expect(playersLabel({ online: 0, max: 20 })).toBe("0/20");
    // Not "0/0": the interface has no idea, and should not claim nobody.
    expect(playersLabel(null)).toBe("—");
  });
});

describe("isPlayerOnline", () => {
  it("matches names case-insensitively", () => {
    // Regression: /daily compared the linked name to the roster with
    // `.includes()`, so a mismatch in case meant never online, ever.
    expect(isPlayerOnline(["LetsGamingDE"], "letsgamingde")).toBe(true);
    expect(isPlayerOnline(["letsgamingde"], "LetsGamingDE")).toBe(true);
  });

  it("does not match a different player", () => {
    expect(isPlayerOnline(["Rxse_exe"], "letsgamingde")).toBe(false);
    expect(isPlayerOnline([], "letsgamingde")).toBe(false);
  });

  it("does not match on a substring", () => {
    expect(isPlayerOnline(["LetsGamingDE420"], "LetsGamingDE")).toBe(false);
  });
});
