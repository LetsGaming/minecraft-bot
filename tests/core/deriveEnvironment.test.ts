import { describe, it, expect } from "vitest";
import { deriveEnvironment } from "../../src/core/utils/modrinth.js";

describe("deriveEnvironment", () => {
  it.each([
    ["required", "required", "both"],
    ["unsupported", "required", "server"],
    ["optional", "required", "optional"],
    ["required", "unsupported", "client"],
    ["optional", "unsupported", "client"],
    ["required", "optional", "optional"],
    ["optional", "optional", "optional"],
    ["unsupported", "unsupported", "unknown"],
    ["", "required", "unknown"],
    ["required", "", "unknown"],
    ["", "", "unknown"],
    ["unknown", "optional", "unknown"],
  ])("client %s + server %s -> %s", (client, server, expected) => {
    expect(deriveEnvironment(client, server)).toBe(expected);
  });
});
