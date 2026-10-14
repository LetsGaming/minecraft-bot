import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { sendCommandOutcome } from "../../src/core/utils/server/serverAccess.js";
import {
  getBreakerState,
  resetBreakersForTesting,
} from "../../src/core/utils/server/circuitBreaker.js";
import { ServerInstance } from "../../src/core/utils/server/server.js";

const cfg = { id: "survival", apiUrl: "https://api.example.com", apiKey: "k" } as never;

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBreakersForTesting();
});

describe("sendCommandOutcome", () => {
  it("maps an RCON reply to delivered", async () => {
    mockFetch.mockResolvedValueOnce(
      reply(200, { result: "Banned Steve", via: "rcon", sent: true }),
    );
    expect(await sendCommandOutcome(cfg, "/ban Steve")).toEqual({
      kind: "delivered",
      output: "Banned Steve",
    });
  });

  it("keeps an empty RCON reply as delivered with empty output", async () => {
    mockFetch.mockResolvedValueOnce(reply(200, { result: "", via: "rcon", sent: true }));
    expect(await sendCommandOutcome(cfg, "/say hi")).toEqual({
      kind: "delivered",
      output: "",
    });
  });

  it("maps a screen send to sent", async () => {
    mockFetch.mockResolvedValueOnce(
      reply(200, { result: null, via: "screen", sent: true }),
    );
    expect(await sendCommandOutcome(cfg, "/say hi")).toEqual({
      kind: "sent",
      via: "screen",
    });
  });

  it("marks a screen send after an RCON failure as rcon-fallback", async () => {
    mockFetch.mockResolvedValueOnce(
      reply(200, { result: null, via: "screen", sent: true, rconError: "refused" }),
    );
    expect(await sendCommandOutcome(cfg, "/say hi")).toEqual({
      kind: "sent",
      via: "rcon-fallback",
    });
  });

  it("marks an RCON command whose reply went missing as sent, not delivered", async () => {
    mockFetch.mockResolvedValueOnce(
      reply(200, { result: null, via: "rcon", sent: true, rconError: "RCON timeout" }),
    );
    expect(await sendCommandOutcome(cfg, "/give Steve diamond")).toEqual({
      kind: "sent",
      via: "rcon-no-reply",
    });
  });

  it("reads an old wrapper's string result as delivered and null as sent", async () => {
    mockFetch.mockResolvedValueOnce(reply(200, { result: "ok" }));
    expect(await sendCommandOutcome(cfg, "list")).toEqual({
      kind: "delivered",
      output: "ok",
    });
    mockFetch.mockResolvedValueOnce(reply(200, { result: null }));
    expect(await sendCommandOutcome(cfg, "list")).toEqual({
      kind: "sent",
      via: "screen",
    });
  });

  it("classifies a 502 as screen-failed without tripping the breaker", async () => {
    for (let i = 0; i < 6; i++) {
      mockFetch.mockResolvedValueOnce(reply(502, { error: "x" }));
      const out = await sendCommandOutcome(cfg, "list");
      expect(out).toMatchObject({ kind: "unreachable", reason: "screen-failed" });
    }
    expect(getBreakerState("survival")).toBe("closed");
  });

  it("classifies a 429 as rate-limited without tripping the breaker", async () => {
    for (let i = 0; i < 6; i++) {
      mockFetch.mockResolvedValueOnce(reply(429, { error: "slow" }));
      expect(await sendCommandOutcome(cfg, "list")).toMatchObject({
        kind: "unreachable",
        reason: "rate-limited",
      });
    }
    expect(getBreakerState("survival")).toBe("closed");
  });

  it("classifies 400 as rejected and other statuses as http-error", async () => {
    mockFetch.mockResolvedValueOnce(reply(400, { error: "bad" }));
    expect(await sendCommandOutcome(cfg, "x")).toMatchObject({ reason: "rejected" });
    mockFetch.mockResolvedValueOnce(reply(401, { error: "no" }));
    expect(await sendCommandOutcome(cfg, "x")).toMatchObject({ reason: "http-error" });
  });

  it("classifies a network failure as wrapper-down and a timeout as timeout", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await sendCommandOutcome(cfg, "x")).toMatchObject({
      kind: "unreachable",
      reason: "wrapper-down",
    });
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    );
    expect(await sendCommandOutcome(cfg, "x")).toMatchObject({ reason: "timeout" });
  });

  it("opens the breaker after repeated transport failures and then fails fast", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
      await sendCommandOutcome(cfg, "x");
    }
    mockFetch.mockClear();
    expect(await sendCommandOutcome(cfg, "x")).toMatchObject({
      kind: "unreachable",
      reason: "breaker-open",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("treats a malformed body as http-error", async () => {
    mockFetch.mockResolvedValueOnce(reply(200, { nope: true }));
    expect(await sendCommandOutcome(cfg, "x")).toMatchObject({ reason: "http-error" });
  });
});

describe("ServerInstance.send", () => {
  it("returns the outcome and never throws", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const inst = new ServerInstance(cfg);
    await expect(inst.send("/list")).resolves.toMatchObject({
      kind: "unreachable",
    });
  });
});
