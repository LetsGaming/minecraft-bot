/**
 * Capability detection tests.
 *
 * - detectCapabilities against a real tmp-dir "suite server" fixture (all
 *   artifacts present) and a "plain server" fixture (none present)
 * - remote conservative all-true fallback when the wrapper lacks the route
 * - capabilityCommandSkips registration gating (incl. mixed setups and the
 *   /server exemption for prune-stats)
 * - requireCapability per-invocation gate produces the documented error
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { detectCapabilities } from "../src/core/utils/serverAccess.js";
import {
  capabilityCommandSkips,
  capabilitySummary,
  requireCapability,
} from "../src/core/utils/capabilities.js";
import { allCapabilities } from "../src/core/types/index.js";
import type { ServerCapabilities, ServerConfig } from "../src/core/types/index.js";
import type { ServerInstance } from "../src/core/utils/server.js";

let root: string;

function cfg(overrides: Partial<ServerConfig>): ServerConfig {
  return {
    id: "test",
    serverDir: "",
    linuxUser: "mc",
    screenSession: "test",
    useRcon: false,
    rconHost: "localhost",
    rconPort: 25575,
    rconPassword: "",
    scriptDir: "",
    ...overrides,
  };
}

/** Fake instance carrying only what the gating helpers read. */
function inst(capabilities: ServerCapabilities | null): ServerInstance {
  return { id: "fake", capabilities } as unknown as ServerInstance;
}

function caps(overrides: Partial<ServerCapabilities>): ServerCapabilities {
  return { ...allCapabilities(), ...overrides };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bot-caps-"));

  // ── Suite fixture: full setup-suite layout ──
  const suiteScripts = path.join(root, "suite", "scripts", "survival");
  for (const rel of [
    "start.sh",
    "shutdown.sh",
    "smart_restart.sh",
    "backup/backup.sh",
    "misc/status.sh",
    "common/downloaded_versions.json",
    "common/variables.txt",
  ]) {
    const p = path.join(suiteScripts, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, rel.endsWith(".json") ? "{}" : "#!/bin/bash\n");
  }
  fs.mkdirSync(path.join(root, "suite", "server"), { recursive: true });
  fs.mkdirSync(path.join(root, "suite", "backups", "survival"), {
    recursive: true,
  });

  // ── Plain fixture: just a server directory, no suite artifacts ──
  fs.mkdirSync(path.join(root, "plain", "server"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Detection ───────────────────────────────────────────────────────────────

describe("detectCapabilities — suite server fixture", () => {
  it("reports every capability as available", async () => {
    const cap = await detectCapabilities(
      cfg({
        serverDir: path.join(root, "suite", "server"),
        screenSession: "survival",
        scriptDir: path.join(root, "suite", "scripts", "survival"),
      }),
    );
    expect(cap).toEqual(allCapabilities());
  });
});

describe("detectCapabilities — plain server fixture", () => {
  it("reports no suite capabilities", async () => {
    const cap = await detectCapabilities(
      cfg({
        serverDir: path.join(root, "plain", "server"),
        screenSession: "plain",
        scriptDir: "",
      }),
    );
    expect(cap).toEqual({
      scripts: {
        start: false,
        stop: false,
        restart: false,
        backup: false,
        status: false,
      },
      backups: false,
      modManifest: false,
      variablesFile: false,
    });
  });

  it("detects partial layouts script-by-script", async () => {
    // Suite fixture minus a script: simulate by pointing scriptDir at a
    // copy that only has start.sh
    const partial = path.join(root, "partial-scripts");
    fs.mkdirSync(partial, { recursive: true });
    fs.writeFileSync(path.join(partial, "start.sh"), "#!/bin/bash\n");

    const cap = await detectCapabilities(
      cfg({
        serverDir: path.join(root, "plain", "server"),
        screenSession: "plain",
        scriptDir: partial,
      }),
    );
    expect(cap.scripts.start).toBe(true);
    expect(cap.scripts.stop).toBe(false);
    expect(cap.modManifest).toBe(false);
  });
});

describe("detectCapabilities — remote wrapper", () => {
  it("falls back to all-true when the wrapper lacks the /capabilities route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Not found", { status: 404 }));
    try {
      const cap = await detectCapabilities(
        cfg({ apiUrl: "https://wrapper.example.com" }),
      );
      expect(cap).toEqual(allCapabilities());
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("uses the wrapper's answer when the route exists", async () => {
    const remote = caps({ backups: false, modManifest: false });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(remote));
    try {
      const cap = await detectCapabilities(
        cfg({ apiUrl: "https://wrapper.example.com" }),
      );
      expect(cap.backups).toBe(false);
      expect(cap.modManifest).toBe(false);
      expect(cap.scripts.start).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// ── Registration gating ─────────────────────────────────────────────────────

describe("capabilityCommandSkips", () => {
  it("skips /backup and /mods when no instance has the capability", () => {
    const skips = capabilityCommandSkips([
      inst(caps({ backups: false, modManifest: false })),
    ]);
    expect(skips.has("backup")).toBe(true);
    expect(skips.has("mods")).toBe(true);
  });

  it("keeps both registered in mixed setups (one suite, one plain server)", () => {
    const skips = capabilityCommandSkips([
      inst(caps({})), // suite server: everything available
      inst(caps({ backups: false, modManifest: false })), // plain server
    ]);
    expect(skips.size).toBe(0);
  });

  it("never skips /server (prune-stats is suite-independent)", () => {
    const skips = capabilityCommandSkips([
      inst(
        caps({
          scripts: {
            start: false,
            stop: false,
            restart: false,
            backup: false,
            status: false,
          },
        }),
      ),
    ]);
    expect(skips.has("server")).toBe(false);
  });

  it("treats unprobed instances as fully capable", () => {
    const skips = capabilityCommandSkips([inst(null)]);
    expect(skips.size).toBe(0);
  });
});

// ── Per-invocation gate ─────────────────────────────────────────────────────

describe("requireCapability", () => {
  it("throws a documented, friendly error when the capability is missing", () => {
    const server = inst(caps({ backups: false }));
    expect(() =>
      requireCapability(server, (c) => c.backups, "the suite backup layout"),
    ).toThrow(/setup-suite layout.*docs\/admin\/setup\.md/s);
  });

  it("passes when the capability exists or the instance is unprobed", () => {
    expect(() =>
      requireCapability(inst(caps({})), (c) => c.backups, "x"),
    ).not.toThrow();
    expect(() =>
      requireCapability(inst(null), (c) => c.backups, "x"),
    ).not.toThrow();
  });
});

// ── Summary line ────────────────────────────────────────────────────────────

describe("capabilitySummary", () => {
  it("lists available scripts and yes/no flags", () => {
    const s = capabilitySummary(
      caps({
        scripts: {
          start: true,
          stop: true,
          restart: false,
          backup: false,
          status: false,
        },
        backups: false,
        modManifest: true,
        variablesFile: false,
      }),
    );
    expect(s).toBe(
      "scripts: start,stop — backups: no, mods: yes, variables.txt: no",
    );
  });
});

// ── Remote deleteStatsFile (prune-stats on remote instances) ───────────────

describe("deleteStatsFile — remote wrapper", () => {
  const UUID = "550e8400-e29b-41d4-a716-446655440000";

  it("calls DELETE /stats/:uuid and returns the wrapper's verdict", async () => {
    const { deleteStatsFile } = await import("../src/core/utils/serverAccess.js");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ deleted: true }));
    try {
      const ok = await deleteStatsFile(
        cfg({ apiUrl: "https://wrapper.example.com", id: "survival" }),
        UUID,
      );
      expect(ok).toBe(true);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe(
        `https://wrapper.example.com/instances/survival/stats/${UUID}`,
      );
      expect((init as RequestInit).method).toBe("DELETE");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("degrades to false on wrappers without the route", async () => {
    const { deleteStatsFile } = await import("../src/core/utils/serverAccess.js");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Cannot DELETE", { status: 404 }));
    try {
      const ok = await deleteStatsFile(
        cfg({ apiUrl: "https://wrapper.example.com" }),
        UUID,
      );
      expect(ok).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
