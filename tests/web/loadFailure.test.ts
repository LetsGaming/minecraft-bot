import { describe, it, expect } from "vitest";
import { ApiError, UnauthorizedError } from "../../src/web/frontend/src/api.js";
import { failureCopy, loadFailure } from "../../src/web/frontend/src/utils/loadFailure.js";
import { CommandHistory } from "../../src/web/frontend/src/utils/commandHistory.js";

const SUBJECT = {
  failedTitle: "The audit log did not load",
  failedText: "Try again in a moment.",
  forbiddenTitle: "You cannot see the audit log",
  capability: "audit:read",
  request: "GET /api/audit",
  error: "Request failed (500)",
};

describe("loadFailure", () => {
  it("sorts a failed read by what the reader can do", () => {
    expect(loadFailure(new UnauthorizedError())).toBe("signedOut");
    expect(loadFailure(new ApiError(403, "no"))).toBe("forbidden");
    expect(loadFailure(new ApiError(502, "Couldn't reach Discord"))).toBe("unreachable");
    expect(loadFailure(new ApiError(503, "wrapper down"))).toBe("unreachable");
    expect(loadFailure(new ApiError(500, "boom"))).toBe("failed");
    expect(loadFailure(new TypeError("Failed to fetch"))).toBe("failed");
  });
});

describe("failureCopy", () => {
  it("offers a way back in instead of a retry when signed out", () => {
    const copy = failureCopy("signedOut", SUBJECT);
    expect(copy.title).toBe("Your session has ended");
    expect(copy.retryable).toBe(true);
    expect(copy.retryLabel).toBe("Sign in again");
    expect(copy.detail).toBe("");
  });

  it("names the missing capability and offers no retry when forbidden", () => {
    const copy = failureCopy("forbidden", SUBJECT);
    expect(copy.title).toBe(SUBJECT.forbiddenTitle);
    expect(copy.recovery).toContain("audit:read");
    expect(copy.retryable).toBe(false);
  });

  it("keeps the request and error for a plain failure", () => {
    const copy = failureCopy("failed", SUBJECT);
    expect(copy.title).toBe(SUBJECT.failedTitle);
    expect(copy.detail).toBe("GET /api/audit: Request failed (500)");
    expect(copy.retryable).toBe(true);
    expect(copy.retryLabel).toBe("");
  });

  it("uses a custom forbidden sentence when access is not a plain grant", () => {
    expect(failureCopy("forbidden", { ...SUBJECT, forbiddenText: "Ask the guild." }).recovery).toBe("Ask the guild.");
  });
});

describe("CommandHistory", () => {
  it("walks back through sent commands and returns the draft at the end", () => {
    const h = new CommandHistory();
    h.record("list");
    h.record("say hi");
    expect(h.previous("wea")).toBe("say hi");
    expect(h.previous("say hi")).toBe("list");
    expect(h.previous("list")).toBeNull();
    expect(h.next()).toBe("say hi");
    expect(h.next()).toBe("wea");
    expect(h.next()).toBeNull();
  });

  it("skips blanks and an immediate repeat, and keeps the limit", () => {
    const h = new CommandHistory(2);
    h.record("  ");
    h.record("a");
    h.record("a");
    h.record("b");
    h.record("c");
    expect(h.previous("")).toBe("c");
    expect(h.previous("")).toBe("b");
    expect(h.previous("")).toBeNull();
  });
});
