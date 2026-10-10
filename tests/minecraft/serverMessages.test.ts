import { describe, it, expect, vi } from "vitest";
import {
  announce,
  tellraw,
  whisper,
} from "../../src/core/utils/minecraft/serverMessages.js";
import { DELIVERED, SENT, UNREACHABLE } from "../fixtures/outcomes.js";

describe("serverMessages", () => {
  it("builds the console command for each helper", async () => {
    const server = { send: vi.fn().mockResolvedValue(DELIVERED) };
    await whisper(server, "Steve", "hi");
    await announce(server, "hello all");
    await tellraw(server, "@a", { text: "x", color: "gold" });
    expect(server.send.mock.calls.map(([c]) => c)).toEqual([
      "/msg Steve hi",
      "/say hello all",
      '/tellraw @a {"text":"x","color":"gold"}',
    ]);
  });

  it("reports delivered and sent as reached, unreachable as not", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(DELIVERED)
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce(UNREACHABLE);
    expect(await whisper({ send }, "a", "b")).toBe(true);
    expect(await whisper({ send }, "a", "b")).toBe(true);
    expect(await whisper({ send }, "a", "b")).toBe(false);
  });
});
