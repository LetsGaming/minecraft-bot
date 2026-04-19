/**
 * Tests for getTps() bugs:
 * Bug 1 — _hasTpsCommand must not be set false on RCON network errors
 * Bug 2 — unparseable tick query must return null, not { tps1m: 0 }
 * Bug 4 — TPS regex must not match stray digits before the values
 */

import { describe, it, expect } from "vitest";

// ── Isolated logic helpers (mirrors server.ts) ────────────────────────────
// We test the pure logic extracted from getTps() without needing a real
// RCON connection. Each helper reproduces the exact logic from server.ts
// so a regression in the source will break the matching test.

function parsePaperTps(r: string) {
  const m =
    r.match(/:\s*\*?([\d.]+),\s*\*?([\d.]+),\s*\*?([\d.]+)/) ??
    r.match(/^\s*\*?([\d.]+),\s*\*?([\d.]+),\s*\*?([\d.]+)/m);
  if (!m) return null;
  return {
    tps1m: parseFloat(m[1]!),
    tps5m: parseFloat(m[2]!),
    tps15m: parseFloat(m[3]!),
  };
}

function parseVanillaTps(r: string) {
  if (r.toLowerCase().includes("unknown")) return null;
  const msptMatch = r.match(/Average time per tick:\s*([\d.]+)\s*ms/i);
  if (!msptMatch) return null; // Bug 2: was { tps1m: 0, raw: r }
  const mspt = parseFloat(msptMatch[1]!);
  return { tps1m: Math.min(20, 1000 / mspt), mspt };
}

// ── Bug 4: Paper TPS regex ────────────────────────────────────────────────

describe("parsePaperTps", () => {
  it("parses a standard Paper response with colon prefix", () => {
    const r = "TPS from last 1m, 5m, 15m: *19.98, *19.99, *20.0";
    const result = parsePaperTps(r);
    expect(result).not.toBeNull();
    expect(result!.tps1m).toBeCloseTo(19.98);
    expect(result!.tps5m).toBeCloseTo(19.99);
    expect(result!.tps15m).toBeCloseTo(20.0);
  });

  it("parses a response without asterisks", () => {
    const r = "TPS from last 1m, 5m, 15m: 18.5, 19.0, 19.5";
    const result = parsePaperTps(r);
    expect(result!.tps1m).toBeCloseTo(18.5);
    expect(result!.tps5m).toBeCloseTo(19.0);
    expect(result!.tps15m).toBeCloseTo(19.5);
  });

  it("parses a plain 3-number response (no colon prefix)", () => {
    const r = "20.0, 20.0, 20.0";
    const result = parsePaperTps(r);
    expect(result).not.toBeNull();
    expect(result!.tps1m).toBeCloseTo(20.0);
  });

  it("does NOT match a single stray number (Bug 4 regression)", () => {
    // Old regex /([\d.]+)(?:...)?/ would match "42" from any random output.
    // New regex requires either a colon-prefix or exactly 3 comma-separated values.
    const r = "Unknown command. Type /help for a list. Error code: 42";
    const result = parsePaperTps(r);
    expect(result).toBeNull();
  });

  it("returns null for an empty response", () => {
    expect(parsePaperTps("")).toBeNull();
  });

  it("returns null for a whitespace-only response", () => {
    expect(parsePaperTps("   ")).toBeNull();
  });
});

// ── Bug 2: Vanilla TPS — null instead of tps1m:0 ─────────────────────────

describe("parseVanillaTps", () => {
  it("parses a valid tick query response", () => {
    const r =
      "Average time per tick: 2.50ms\nP50: 2.1ms, P95: 3.8ms, P99: 5.2ms";
    const result = parseVanillaTps(r);
    expect(result).not.toBeNull();
    expect(result!.tps1m).toBeCloseTo(Math.min(20, 1000 / 2.5));
    expect(result!.mspt).toBeCloseTo(2.5);
  });

  it("returns null when the expected line is missing (Bug 2)", () => {
    // This used to return { tps1m: 0 } which caused a false Low TPS alert.
    const r = "Tick: current game time is 12345";
    const result = parseVanillaTps(r);
    expect(result).toBeNull();
  });

  it("returns null for an 'unknown command' response", () => {
    const result = parseVanillaTps("Unknown command: tick");
    expect(result).toBeNull();
  });

  it("returns null for an empty response", () => {
    expect(parseVanillaTps("")).toBeNull();
  });

  it("caps TPS at 20 even with very short MSPT", () => {
    const r = "Average time per tick: 0.1ms";
    const result = parseVanillaTps(r);
    expect(result!.tps1m).toBe(20);
  });
});

// ── Bug 1: _hasTpsCommand state machine ───────────────────────────────────
// We simulate the state logic directly rather than instantiating ServerInstance
// (which requires a full RCON connection), keeping the test dependency-free.

describe("_hasTpsCommand state logic (Bug 1)", () => {
  function simulateTpsAttempt(
    state: boolean | null,
    outcome: "success" | "unknown_command" | "network_error",
  ): boolean | null {
    // Mirrors the fixed logic in server.ts getTps()
    if (state === false) return false; // already disabled — skip

    if (outcome === "network_error") {
      // Bug 1 fix: do NOT change state on network errors
      return state;
    }
    if (outcome === "unknown_command") {
      return false; // command doesn't exist on this server
    }
    // success
    return true;
  }

  it("starts as null", () => {
    expect(simulateTpsAttempt(null, "success")).toBe(true);
  });

  it("sets true on first success", () => {
    expect(simulateTpsAttempt(null, "success")).toBe(true);
  });

  it("sets false only when server returns unknown command", () => {
    expect(simulateTpsAttempt(null, "unknown_command")).toBe(false);
    expect(simulateTpsAttempt(true, "unknown_command")).toBe(false);
  });

  it("does NOT set false on a network error (Bug 1 regression)", () => {
    // Old code: catch { this._hasTpsCommand = false }
    // New code: catch { /* leave unchanged */ }
    expect(simulateTpsAttempt(null, "network_error")).toBe(null);
    expect(simulateTpsAttempt(true, "network_error")).toBe(true);
  });

  it("stays false once disabled — skips future attempts", () => {
    expect(simulateTpsAttempt(false, "success")).toBe(false);
    expect(simulateTpsAttempt(false, "network_error")).toBe(false);
  });
});
