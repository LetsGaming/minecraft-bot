/**
 * Deciding a whitelist application is claim, act, settle: only the admin who
 * wins the claim may act, and a failed action gives the application back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting } from "../../src/core/db/index.js";
import {
  CLAIM_TTL_MS,
  addPendingApplication,
  claimWhitelistApplication,
  countPendingApplications,
  loadWhitelistApplications,
  releaseWhitelistApplication,
  removeWhitelistApplication,
  settleWhitelistApplication,
  type WhitelistApplication,
} from "../../src/core/utils/stores/whitelistApplicationStore.js";

const app = (id: string, over: Partial<WhitelistApplication> = {}): WhitelistApplication => ({
  id,
  guildId: "g1",
  userId: "u1",
  userTag: "user#1",
  mcName: "Steve",
  serverId: "smp",
  status: "pending",
  createdAt: 1,
  ...over,
});

const decision = (over: Partial<Parameters<typeof settleWhitelistApplication>[2]> = {}) => ({
  status: "approved" as const,
  mcName: "Steve",
  decidedBy: "admin#1",
  decidedAt: 10,
  ...over,
});

beforeEach(() => {
  closeDbForTesting();
});

describe("addPendingApplication", () => {
  it("refuses a second pending application from the same user in the same guild", () => {
    expect(addPendingApplication(app("a1"), 1)).toBe(true);
    expect(addPendingApplication(app("a2"), 1)).toBe(false);
    expect(addPendingApplication(app("a3", { guildId: "g2" }), 1)).toBe(true);
    expect(addPendingApplication(app("a4", { userId: "u2" }), 1)).toBe(true);
    expect(loadWhitelistApplications().applications.map((a) => a.id)).toEqual(["a1", "a3", "a4"]);
  });

  it("counts a claimed application as pending", () => {
    addPendingApplication(app("a1"), 1);
    claimWhitelistApplication("a1", "g1", "admin1");
    expect(countPendingApplications("g1", "u1")).toBe(1);
  });
});

describe("removeWhitelistApplication", () => {
  it("drops one application and keeps the rest", () => {
    addPendingApplication(app("a1"), 5);
    addPendingApplication(app("a2"), 5);
    removeWhitelistApplication("a1");
    expect(loadWhitelistApplications().applications.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("claimWhitelistApplication", () => {
  it("hands the application to exactly one claimer", () => {
    addPendingApplication(app("a1"), 1);
    expect(claimWhitelistApplication("a1", "g1", "admin1", 1_000)?.id).toBe("a1");
    expect(claimWhitelistApplication("a1", "g1", "admin2", 1_001)).toBeNull();
  });

  it("refuses unknown, decided and foreign-guild applications", () => {
    addPendingApplication(app("a1"), 5);
    addPendingApplication(app("a2", { userId: "u2", status: "denied", decidedAt: 2 }), 5);
    expect(claimWhitelistApplication("missing", "g1", "admin1")).toBeNull();
    expect(claimWhitelistApplication("a1", "other", "admin1")).toBeNull();
    expect(claimWhitelistApplication("a2", "g1", "admin1")).toBeNull();
  });

  it("lets a later admin take over a claim past its expiry", () => {
    addPendingApplication(app("a1"), 1);
    claimWhitelistApplication("a1", "g1", "admin1", 1_000);
    expect(claimWhitelistApplication("a1", "g1", "admin2", 1_000 + CLAIM_TTL_MS - 1)).toBeNull();
    expect(claimWhitelistApplication("a1", "g1", "admin2", 1_000 + CLAIM_TTL_MS)?.id).toBe("a1");
  });
});

describe("releaseWhitelistApplication", () => {
  it("makes the application claimable again, but only for the holder", () => {
    addPendingApplication(app("a1"), 1);
    claimWhitelistApplication("a1", "g1", "admin1");

    releaseWhitelistApplication("a1", "admin2");
    expect(claimWhitelistApplication("a1", "g1", "admin3")).toBeNull();

    releaseWhitelistApplication("a1", "admin1");
    expect(claimWhitelistApplication("a1", "g1", "admin3")?.id).toBe("a1");
  });
});

describe("settleWhitelistApplication", () => {
  it("records the decision for the claim holder and clears the claim", () => {
    addPendingApplication(app("a1"), 1);
    claimWhitelistApplication("a1", "g1", "admin1");

    const settled = settleWhitelistApplication("a1", "admin1", decision({ mcName: "StEvE" }));

    expect(settled).toMatchObject({ status: "approved", mcName: "StEvE", decidedBy: "admin#1" });
    const stored = loadWhitelistApplications().applications[0]!;
    expect(stored.status).toBe("approved");
    expect(stored).not.toHaveProperty("claim");
  });

  it("refuses anyone who does not hold the claim", () => {
    addPendingApplication(app("a1"), 1);
    expect(settleWhitelistApplication("a1", "admin1", decision())).toBeNull();
    claimWhitelistApplication("a1", "g1", "admin1");
    expect(settleWhitelistApplication("a1", "admin2", decision())).toBeNull();
    expect(loadWhitelistApplications().applications[0]!.status).toBe("pending");
  });

  it("settles only once", () => {
    addPendingApplication(app("a1"), 1);
    claimWhitelistApplication("a1", "g1", "admin1");
    expect(settleWhitelistApplication("a1", "admin1", decision())).not.toBeNull();
    expect(settleWhitelistApplication("a1", "admin1", decision({ status: "denied" }))).toBeNull();
  });
});
