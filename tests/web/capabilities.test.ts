/**
 * RBAC-01 — the pure capability contract. No Fastify, no config loading: this
 * is the resolution logic every gate depends on, exercised directly.
 *
 * The route gate and the boot assertion live in capabilityGate.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  GRANTABLE_CAPABILITIES,
  SYSADMIN_ONLY_CAPABILITIES,
  IRREVERSIBLE_CAPABILITIES,
  ALL_SERVERS,
  isCapability,
  isGrantableCapability,
  resolveCapabilities,
  hasCapability,
  grantedServerIds,
  hasWildcardGrant,
  type CapabilityGrants,
} from "../../src/schema/capabilities.js";

const ALICE = "111111111111111111"; // wildcard operator
const BOB = "222222222222222222"; // config editor on one server
const CAROL = "333333333333333333"; // not in the grants at all

const grants: CapabilityGrants = {
  [ALICE]: { [ALL_SERVERS]: ["server:read", "server:control", "audit:read"] },
  [BOB]: {
    survival: ["config:read", "config:write"],
    creative: ["server:read"],
  },
};

describe("the capability set", () => {
  it("keeps grantable and sysadmin-only capabilities disjoint", () => {
    for (const cap of SYSADMIN_ONLY_CAPABILITIES) {
      expect(isGrantableCapability(cap)).toBe(false);
      expect(isCapability(cap)).toBe(true);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("treats every irreversible capability as a real one", () => {
    for (const cap of IRREVERSIBLE_CAPABILITIES) {
      expect(isCapability(cap)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isCapability("server:delete")).toBe(false);
    expect(isGrantableCapability("")).toBe(false);
  });
});

describe("resolveCapabilities", () => {
  it("returns the wildcard block for any server", () => {
    const caps = resolveCapabilities(grants, ALICE, "survival");
    expect([...caps].sort()).toEqual(
      ["audit:read", "server:control", "server:read"].sort(),
    );
  });

  it("unions the wildcard block with the per-server block", () => {
    const mixed: CapabilityGrants = {
      [BOB]: {
        [ALL_SERVERS]: ["server:read"],
        survival: ["config:write"],
      },
    };
    const caps = resolveCapabilities(mixed, BOB, "survival");
    expect([...caps].sort()).toEqual(["config:write", "server:read"]);
  });

  it("scopes a per-server grant to that server only", () => {
    expect(resolveCapabilities(grants, BOB, "survival")).toContain(
      "config:write",
    );
    expect(resolveCapabilities(grants, BOB, "creative")).not.toContain(
      "config:write",
    );
  });

  it("returns only the wildcard block when no server is named", () => {
    // SECURITY: a fleet-wide route must not be satisfied by a single-server
    // grant. Bob has capabilities, but none of them globally.
    expect(resolveCapabilities(grants, BOB).size).toBe(0);
    expect(resolveCapabilities(grants, ALICE).size).toBe(3);
  });

  it("is empty for an unknown user", () => {
    expect(resolveCapabilities(grants, CAROL, "survival").size).toBe(0);
  });

  it("is empty when grants are absent", () => {
    expect(resolveCapabilities(undefined, ALICE, "survival").size).toBe(0);
  });

  it("drops unknown strings rather than trusting them", () => {
    const typo = {
      [ALICE]: { [ALL_SERVERS]: ["server:reed", "server:read"] },
    } as unknown as CapabilityGrants;
    const caps = resolveCapabilities(typo, ALICE, "survival");
    expect([...caps]).toEqual(["server:read"]);
  });

  it("drops a hand-written sysadmin-only capability", () => {
    // Writing "bot:config" into the file by hand must not make it assignable.
    const escalation = {
      [BOB]: { [ALL_SERVERS]: ["bot:config"] },
    } as unknown as CapabilityGrants;
    expect(resolveCapabilities(escalation, BOB, "survival").size).toBe(0);
  });

  it("survives a malformed block", () => {
    const junk = {
      [ALICE]: { [ALL_SERVERS]: "server:read" },
    } as unknown as CapabilityGrants;
    expect(resolveCapabilities(junk, ALICE, "survival").size).toBe(0);
  });

  it("does not treat a literal '*' serverId as a second block", () => {
    const caps = resolveCapabilities(grants, ALICE, ALL_SERVERS);
    expect(caps.size).toBe(3);
  });
});

describe("hasCapability", () => {
  it("grants a wildcard holder on a named server", () => {
    expect(hasCapability(grants, ALICE, "server:control", "survival")).toBe(
      true,
    );
  });

  it("denies a capability the user was never given", () => {
    expect(hasCapability(grants, ALICE, "backup:restore", "survival")).toBe(
      false,
    );
  });

  it("denies a per-server grant on a different server", () => {
    expect(hasCapability(grants, BOB, "config:write", "creative")).toBe(false);
  });

  it("denies a per-server grant on a fleet-wide route", () => {
    expect(hasCapability(grants, BOB, "config:write")).toBe(false);
  });

  it("always denies a sysadmin-only capability", () => {
    // Sysadmins never reach this function: the web layer short-circuits them.
    expect(hasCapability(grants, ALICE, "bot:config", "survival")).toBe(false);
    expect(hasCapability(grants, ALICE, "bot:config")).toBe(false);
  });
});

describe("grantedServerIds / hasWildcardGrant", () => {
  it("lists named servers and excludes the wildcard", () => {
    expect(grantedServerIds(grants, BOB).sort()).toEqual([
      "creative",
      "survival",
    ]);
    expect(grantedServerIds(grants, ALICE)).toEqual([]);
  });

  it("reports the wildcard separately", () => {
    expect(hasWildcardGrant(grants, ALICE)).toBe(true);
    expect(hasWildcardGrant(grants, BOB)).toBe(false);
    expect(hasWildcardGrant(grants, CAROL)).toBe(false);
    expect(hasWildcardGrant(undefined, ALICE)).toBe(false);
  });
});

describe("GRANTABLE_CAPABILITIES ordering", () => {
  it("lists read capabilities before irreversible ones", () => {
    const idx = (c: string) =>
      (GRANTABLE_CAPABILITIES as readonly string[]).indexOf(c);
    expect(idx("server:read")).toBeLessThan(idx("server:control"));
    expect(idx("server:control")).toBeLessThan(idx("server:console"));
    expect(idx("server:console")).toBeLessThan(idx("backup:restore"));
  });
});
