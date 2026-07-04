import { describe, it, expect } from "vitest";
import { validateApiUrl } from "../src/config.js";

// The remote API wrapper carries full server-control authority
// behind a static x-api-key. Plaintext HTTP is only acceptable on a
// trusted local segment; anything public must use TLS.

describe("validateApiUrl", () => {
  it("accepts https to any host", () => {
    expect(validateApiUrl("https://mc-api.example.com").level).toBe("ok");
    expect(validateApiUrl("https://203.0.113.7:3000").level).toBe("ok");
  });

  it("allows plaintext http to loopback with a warning", () => {
    expect(validateApiUrl("http://127.0.0.1:3000").level).toBe("warn");
    expect(validateApiUrl("http://localhost:3000").level).toBe("warn");
    expect(validateApiUrl("http://[::1]:3000").level).toBe("warn");
  });

  it("allows plaintext http to RFC1918 / link-local addresses with a warning", () => {
    expect(validateApiUrl("http://192.168.1.10:3000").level).toBe("warn");
    expect(validateApiUrl("http://10.0.0.5:3000").level).toBe("warn");
    expect(validateApiUrl("http://172.16.0.1:3000").level).toBe("warn");
    expect(validateApiUrl("http://172.31.255.1:3000").level).toBe("warn");
    expect(validateApiUrl("http://169.254.1.1:3000").level).toBe("warn");
  });

  it("allows plaintext http to LAN-style hostnames with a warning", () => {
    expect(validateApiUrl("http://mc-host:3000").level).toBe("warn"); // single-label
    expect(validateApiUrl("http://server.local:3000").level).toBe("warn");
    expect(validateApiUrl("http://nas.lan:3000").level).toBe("warn");
    expect(validateApiUrl("http://mc.internal:3000").level).toBe("warn");
    expect(validateApiUrl("http://box.home.arpa:3000").level).toBe("warn");
  });

  it("rejects plaintext http to public IPs and FQDNs", () => {
    expect(validateApiUrl("http://203.0.113.7:3000").level).toBe("error");
    expect(validateApiUrl("http://mc-api.example.com:3000").level).toBe(
      "error",
    );
    // 172.32.x.x is just outside the 172.16/12 private block
    expect(validateApiUrl("http://172.32.0.1:3000").level).toBe("error");
  });

  it("mentions the remediation options in the rejection message", () => {
    const res = validateApiUrl("http://mc-api.example.com:3000");
    expect(res.level).toBe("error");
    if (res.level === "error") {
      expect(res.message).toMatch(/https/);
      expect(res.message).toMatch(/allowInsecureHttp/);
    }
  });

  it("downgrades the public-http rejection to a warning with allowInsecureHttp", () => {
    const res = validateApiUrl("http://mc-api.example.com:3000", true);
    expect(res.level).toBe("warn");
    if (res.level === "warn") {
      expect(res.message).toMatch(/PLAINTEXT/i);
    }
  });

  it("rejects malformed URLs and non-http(s) schemes", () => {
    expect(validateApiUrl("not a url").level).toBe("error");
    expect(validateApiUrl("ftp://192.168.1.10").level).toBe("error");
  });

  it("is not fooled by private-looking prefixes in hostnames", () => {
    // hostname starts with "fc"/"fd" but is not an IPv6 ULA literal
    expect(validateApiUrl("http://fcserver.example.com").level).toBe("error");
    // public IPv4 that merely contains "10." deeper in the address
    expect(validateApiUrl("http://8.10.0.1").level).toBe("error");
  });
});
