import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createTrustProxyFn,
  createProxyMisconfigurationWarning,
  parseTrustProxy,
} from "../../src/web/backend/trustProxy.js";
import { log } from "../../src/core/utils/logger.js";

beforeEach(() => vi.mocked(log.warn).mockClear());

describe("parseTrustProxy", () => {
  it("trusts nothing by default", () => {
    expect(parseTrustProxy(undefined)("10.0.0.1", 0)).toBe(false);
    expect(parseTrustProxy(false)("10.0.0.1", 0)).toBe(false);
  });

  it("true trusts every hop", () => {
    expect(parseTrustProxy(true)("203.0.113.9", 5)).toBe(true);
  });

  it("a hop count trusts only the first n hops", () => {
    const fn = parseTrustProxy(2);
    expect([fn("a", 0), fn("a", 1), fn("a", 2)]).toEqual([true, true, false]);
  });

  it("matches IPs, CIDR ranges and aliases, including IPv4-mapped peers", () => {
    const fn = parseTrustProxy(["172.16.0.0/12", "203.0.113.9", "loopback"]);
    expect(fn("172.18.0.2", 0)).toBe(true);
    expect(fn("::ffff:172.18.0.2", 0)).toBe(true);
    expect(fn("203.0.113.9", 0)).toBe(true);
    expect(fn("127.0.0.1", 0)).toBe(true);
    expect(fn("::1", 0)).toBe(true);
    expect(fn("172.32.0.1", 0)).toBe(false);
    expect(fn("198.51.100.7", 0)).toBe(false);
  });

  it.each([0, -1, 1.5, 100, NaN, "1", "10.0.0.0/8", [], [""], [1], ["10.0.0.0/33"], ["nope"], ["1.2.3.4/x"], {}])(
    "trusts nothing for the invalid value %j",
    (bad) => {
      expect(parseTrustProxy(bad)("10.0.0.1", 0)).toBe(false);
    },
  );
});

describe("createTrustProxyFn", () => {
  it("follows config changes without being rebuilt", () => {
    let value: unknown = false;
    const fn = createTrustProxyFn(() => value);
    expect(fn("10.1.2.3", 0)).toBe(false);
    value = ["10.0.0.0/8"];
    expect(fn("10.1.2.3", 0)).toBe(true);
    value = ["192.168.0.0/16"];
    expect(fn("10.1.2.3", 0)).toBe(false);
    value = false;
    expect(fn("192.168.0.1", 0)).toBe(false);
  });

  it("does not trust and warns once for an invalid value", () => {
    const fn = createTrustProxyFn(() => ["not-an-ip"]);
    expect(fn("10.1.2.3", 0)).toBe(false);
    expect(fn("10.1.2.3", 0)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("does not trust when reading the setting throws", () => {
    const fn = createTrustProxyFn(() => {
      throw new Error("config unreadable");
    });
    expect(fn("10.1.2.3", 0)).toBe(false);
  });
});

describe("client address resolution in Fastify", () => {
  async function ipFor(read: () => unknown) {
    const app = Fastify({ trustProxy: createTrustProxyFn(read) });
    app.get("/ip", (req) => ({ ip: req.ip }));
    const res = await app.inject({
      method: "GET",
      url: "/ip",
      remoteAddress: "10.1.2.3",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    await app.close();
    return (res.json() as { ip: string }).ip;
  }

  it("ignores a spoofed X-Forwarded-For when no proxy is trusted", async () => {
    expect(await ipFor(() => undefined)).toBe("10.1.2.3");
  });

  it("ignores it when the setting is invalid", async () => {
    expect(await ipFor(() => ["garbage"])).toBe("10.1.2.3");
  });

  it("honors it only from a listed proxy range", async () => {
    expect(await ipFor(() => ["10.0.0.0/8"])).toBe("203.0.113.9");
    expect(await ipFor(() => ["192.168.0.0/16"])).toBe("10.1.2.3");
  });

  it("applies a config change to the same running server", async () => {
    let value: unknown = false;
    const app = Fastify({ trustProxy: createTrustProxyFn(() => value) });
    app.get("/ip", (req) => ({ ip: req.ip }));
    const get = async () =>
      (
        (
          await app.inject({
            method: "GET",
            url: "/ip",
            remoteAddress: "10.1.2.3",
            headers: { "x-forwarded-for": "203.0.113.9" },
          })
        ).json() as { ip: string }
      ).ip;
    expect(await get()).toBe("10.1.2.3");
    value = ["10.0.0.0/8"];
    expect(await get()).toBe("203.0.113.9");
    value = false;
    expect(await get()).toBe("10.1.2.3");
    await app.close();
  });
});

describe("misconfiguration warning", () => {
  it("warns once for proxy headers from a private peer that is not trusted", () => {
    const warn = createProxyMisconfigurationWarning(() => false);
    warn("172.18.0.2", { "x-forwarded-for": "203.0.113.9" });
    warn("172.18.0.2", { "x-forwarded-for": "203.0.113.9" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(log.warn).mock.calls[0]![1])).toContain("webui.trustProxy");
  });

  it("stays quiet without proxy headers, for public peers, or when trusted", () => {
    createProxyMisconfigurationWarning(() => false)("172.18.0.2", {});
    createProxyMisconfigurationWarning(() => false)("198.51.100.4", { "x-forwarded-for": "1.1.1.1" });
    createProxyMisconfigurationWarning(() => true)("172.18.0.2", { "x-forwarded-for": "1.1.1.1" });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
