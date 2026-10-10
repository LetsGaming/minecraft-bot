import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveTrustProxy } from "../../src/web/backend/trustProxy.js";
import { log } from "../../src/core/utils/logger.js";

describe("resolveTrustProxy", () => {
  it("trusts nothing by default", () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy(false)).toBe(false);
  });

  it("accepts aliases, IPv4, IPv6 and CIDR entries", () => {
    expect(resolveTrustProxy(["loopback", "::1", "fd00::/8", "172.16.0.0/12"])).toHaveLength(4);
  });

  it("accepts a list of addresses and trims entries", () => {
    expect(resolveTrustProxy([" 10.0.0.0/8", "127.0.0.1"])).toEqual(["10.0.0.0/8", "127.0.0.1"]);
  });

  it("allows true but warns", () => {
    vi.mocked(log.warn).mockClear();
    expect(resolveTrustProxy(true)).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });

  it.each([1, 0, NaN, "1", "10.0.0.0/8", [], [""], [1], ["10.0.0.0/33"], ["nope"], ["1.2.3.4/x"], {}])(
    "falls back to false for %j",
    (bad) => {
      expect(resolveTrustProxy(bad)).toBe(false);
    },
  );
});

describe("client address resolution", () => {
  async function ipFor(setting: ReturnType<typeof resolveTrustProxy>) {
    const app = Fastify({ trustProxy: setting });
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

  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    expect(await ipFor(resolveTrustProxy(undefined))).toBe("10.1.2.3");
  });

  it("honors it only from a listed proxy range", async () => {
    expect(await ipFor(resolveTrustProxy(["10.0.0.0/8"]))).toBe("203.0.113.9");
    expect(await ipFor(resolveTrustProxy(["192.168.0.0/16"]))).toBe("10.1.2.3");
  });
});
