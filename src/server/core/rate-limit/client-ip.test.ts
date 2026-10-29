import { afterEach, describe, expect, it } from "vitest";
import { normalizeAccountIdentifier, resolveClientIp } from "./enforce-rate-limit";

const request = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });

afterEach(() => {
  delete process.env.CLIENT_IP_TRUSTED_HOPS;
  delete process.env.TRUST_X_REAL_IP;
  delete process.env.STORE_PHONE_COUNTRY_CODE;
});

describe("resolveClientIp — only what a trusted proxy wrote is believed", () => {
  it("takes the RIGHT-most x-forwarded-for entry, never the client-controlled left side", () => {
    expect(resolveClientIp(request({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("a single forwarded value (what the storefront BFF sends) is used as is", () => {
    expect(resolveClientIp(request({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("an attacker rotating the left-most entry does not change the bucket", () => {
    const a = resolveClientIp(request({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }));
    const b = resolveClientIp(request({ "x-forwarded-for": "2.2.2.2, 203.0.113.9" }));
    expect(a).toBe(b);
  });

  it("CLIENT_IP_TRUSTED_HOPS skips the infrastructure entries appended after the forwarded client", () => {
    process.env.CLIENT_IP_TRUSTED_HOPS = "2";
    expect(resolveClientIp(request({ "x-forwarded-for": "evil, 198.51.100.4, 10.0.0.2" }))).toBe("198.51.100.4");
  });

  it("never reads past the start of the list, and ignores a malformed hop count", () => {
    process.env.CLIENT_IP_TRUSTED_HOPS = "5";
    expect(resolveClientIp(request({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
    process.env.CLIENT_IP_TRUSTED_HOPS = "banana";
    expect(resolveClientIp(request({ "x-forwarded-for": "a, b" }))).toBe("b");
  });

  it("x-real-ip is ignored unless TRUST_X_REAL_IP=1 says the proxy overwrites it", () => {
    expect(resolveClientIp(request({ "x-real-ip": "9.9.9.9" }))).toBe("unknown");
    process.env.TRUST_X_REAL_IP = "1";
    expect(resolveClientIp(request({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
  });

  it("falls to one shared 'unknown' bucket with no usable header — stricter, never open", () => {
    expect(resolveClientIp(request({}))).toBe("unknown");
    expect(resolveClientIp(request({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});

describe("normalizeAccountIdentifier — one counter per account, however it is spelled", () => {
  it("lower-cases and trims an email", () => {
    expect(normalizeAccountIdentifier("  Mona@Example.COM ")).toBe("mona@example.com");
  });

  it("canonicalises a phone, so national and international spellings share a counter", () => {
    process.env.STORE_PHONE_COUNTRY_CODE = "20";
    expect(normalizeAccountIdentifier("0100 123 4567")).toBe("+201001234567");
    expect(normalizeAccountIdentifier("+20 100 123 4567")).toBe("+201001234567");
    expect(normalizeAccountIdentifier("٠١٠٠١٢٣٤٥٦٧")).toBe("+201001234567");
  });
});
