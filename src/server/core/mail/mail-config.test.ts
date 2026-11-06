import { describe, expect, it, vi } from "vitest";
import { announceMailStatus, mailAnnouncement, mailConfigStatus } from "./mail-config";

const FULL = {
  SMTP_HOST: "smtp.provider.example",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASS: "not-a-real-password",
  MAIL_FROM: "Store <orders@shop.example>",
  STOREFRONT_URL: "https://shop.example/",
  BACKOFFICE_URL: "https://console.shop.example",
};

describe("mailConfigStatus", () => {
  it("is OFF when no mail variable is set", () => {
    expect(mailConfigStatus({}).state).toBe("off");
  });

  it("is OFF when only blanks or the two link bases are set — a base URL alone is not an intent to send", () => {
    expect(mailConfigStatus({ SMTP_HOST: "  ", STOREFRONT_URL: "https://shop.example", BACKOFFICE_URL: "https://console.shop.example" }).state).toBe("off");
  });

  it("is configured when everything is present, normalising the URLs and requiring TLS on 587", () => {
    const status = mailConfigStatus(FULL);
    expect(status.state).toBe("configured");
    if (status.state !== "configured") return;
    expect(status.config).toMatchObject({ host: "smtp.provider.example", port: 587, secure: false, requireTLS: true, user: "mailer", from: "Store <orders@shop.example>", storefrontUrl: "https://shop.example", backofficeUrl: "https://console.shop.example" });
  });

  it("port 465 is implicit TLS without SMTP_SECURE, and is not forced through STARTTLS", () => {
    const status = mailConfigStatus({ ...FULL, SMTP_PORT: "465" });
    expect(status.state === "configured" && status.config).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it("allows an unauthenticated relay: no user and no password", () => {
    const rest: Record<string, string> = { ...FULL };
    delete rest.SMTP_USER;
    delete rest.SMTP_PASS;
    expect(mailConfigStatus({ ...rest, SMTP_PORT: "1025" }).state).toBe("configured");
  });

  it("is half-configured when a required variable is missing, and names exactly those variables", () => {
    const rest: Record<string, string> = { ...FULL };
    delete rest.SMTP_PASS;
    delete rest.MAIL_FROM;
    const status = mailConfigStatus(rest);
    expect(status.state).toBe("half-configured");
    if (status.state !== "half-configured") return;
    expect(status.problems).toEqual(["SMTP_PASS", "MAIL_FROM"]);
    expect(status.message).toContain("half-configured");
    expect(status.message).toContain("SMTP_PASS, MAIL_FROM");
  });

  it("a missing STOREFRONT_URL or BACKOFFICE_URL while SMTP is configured is half-configured", () => {
    expect(mailConfigStatus({ ...FULL, STOREFRONT_URL: undefined })).toMatchObject({ state: "half-configured", problems: ["STOREFRONT_URL"] });
    expect(mailConfigStatus({ ...FULL, BACKOFFICE_URL: undefined })).toMatchObject({ state: "half-configured", problems: ["BACKOFFICE_URL"] });
  });

  it.each([
    ["a non-numeric port", { SMTP_PORT: "abc" }, "SMTP_PORT (not a valid port number)"],
    ["SMTP_SECURE=true on 587", { SMTP_SECURE: "true" }, "SMTP_SECURE (true is only for port 465)"],
    ["SMTP_SECURE=false on 465", { SMTP_PORT: "465", SMTP_SECURE: "false" }, "SMTP_SECURE (port 465 needs true)"],
    ["a junk SMTP_SECURE", { SMTP_SECURE: "yes" }, "SMTP_SECURE (must be true or false)"],
    ["a non-http base URL", { STOREFRONT_URL: "ftp://shop.example" }, "STOREFRONT_URL (not an http(s) URL)"],
    ["an unparseable base URL", { BACKOFFICE_URL: "console" }, "BACKOFFICE_URL (not an http(s) URL)"],
    ["a user without a password", { SMTP_PASS: undefined }, "SMTP_PASS"],
    ["a password without a user", { SMTP_USER: undefined }, "SMTP_USER"],
  ])("is half-configured for %s", (_label, override, problem) => {
    const status = mailConfigStatus({ ...FULL, ...override });
    expect(status.state).toBe("half-configured");
    expect(status.state === "half-configured" && status.problems).toContain(problem);
  });

  it("never puts a value in a message — only variable names", () => {
    const status = mailConfigStatus({ ...FULL, SMTP_PORT: "abc", MAIL_FROM: undefined });
    for (const secret of ["not-a-real-password", "mailer", "smtp.provider.example", "orders@shop.example", "shop.example"]) {
      expect(status.message).not.toContain(secret);
    }
  });
});

describe("the boot announcement", () => {
  const off = mailConfigStatus({});
  const half = mailConfigStatus({ SMTP_HOST: "smtp.provider.example" });
  const ok = mailConfigStatus(FULL);

  it("OFF is a warning outside production and an ERROR in production", () => {
    expect(mailAnnouncement(off, "development").level).toBe("warn");
    expect(mailAnnouncement(off, "production").level).toBe("error");
    expect(mailAnnouncement(off, "production").message).toMatch(/^\[mail\] no mail variables are set/);
    expect(mailAnnouncement(off, "production").message).toContain("NO email is delivered");
  });

  it("half-configured is loud in the same way, and says what is missing by name", () => {
    expect(mailAnnouncement(half, "production").level).toBe("error");
    const message = mailAnnouncement(half, "production").message;
    expect(message).toContain("half-configured: missing or invalid SMTP_PORT, MAIL_FROM, STOREFRONT_URL, BACKOFFICE_URL");
  });

  it("configured is plain information, never a warning", () => {
    expect(mailAnnouncement(ok, "production")).toEqual({ level: "info", message: "[mail] SMTP delivery is configured." });
  });

  it("announceMailStatus writes exactly one line, at the matching console level", () => {
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    announceMailStatus(off, "production", sink);
    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.log).not.toHaveBeenCalled();

    const sink2 = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    announceMailStatus(ok, "production", sink2);
    expect(sink2.log).toHaveBeenCalledTimes(1);
    expect(sink2.error).not.toHaveBeenCalled();
  });
});
