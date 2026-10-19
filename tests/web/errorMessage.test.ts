import { describe, it, expect } from "vitest";
import { errorMessage, apiErrorText } from "../../src/web/frontend/src/utils/errorMessage.js";
import { ApiError } from "../../src/web/frontend/src/api.js";

describe("errorMessage", () => {
  it("reads Errors, strings and plain objects with a message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ message: "from object" })).toBe("from object");
  });

  it("uses the fallback when there is no usable text", () => {
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(errorMessage({ code: 1 }, "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("stringifies a bare value when no fallback is given", () => {
    expect(errorMessage(42)).toBe("42");
  });
});

describe("apiErrorText", () => {
  it("puts the HTTP status in front of a failed request", () => {
    expect(apiErrorText(new ApiError(404, "not found"))).toBe("404: not found");
  });

  it("behaves like errorMessage for anything else", () => {
    expect(apiErrorText(new Error("x"))).toBe("x");
    expect(apiErrorText(null, "no response")).toBe("no response");
  });
});
