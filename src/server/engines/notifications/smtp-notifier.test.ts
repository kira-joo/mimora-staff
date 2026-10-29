import nodemailer from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { createSmtpOutboundNotifier, type MailTransport } from "./smtp-notifier";

const logger = () => ({ warn: vi.fn(), info: vi.fn() });
const allLogs = (l: ReturnType<typeof logger>) => [...l.info.mock.calls, ...l.warn.mock.calls].flat().join("\n");

describe("createSmtpOutboundNotifier", () => {
  it("hands Nodemailer a complete message (checked against its real jsonTransport, nothing is sent)", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const spy = vi.spyOn(transport, "sendMail");
    const notifier = createSmtpOutboundNotifier({ transport, from: "Store <orders@shop.example>", replyTo: "help@shop.example", logger: logger() });

    await notifier.send({ channel: "EMAIL", to: "customer@example.com", subject: "Hello", body: "plain", html: "<p>html</p>", template: "t" });

    const sent = (await spy.mock.results[0]!.value) as { message: string };
    const message = JSON.parse(sent.message) as Record<string, unknown>;
    expect(message.subject).toBe("Hello");
    expect(message.text).toBe("plain");
    expect(message.html).toBe("<p>html</p>");
    expect(JSON.stringify(message.from)).toContain("orders@shop.example");
    expect(JSON.stringify(message.to)).toContain("customer@example.com");
    expect(JSON.stringify(message.replyTo)).toContain("help@shop.example");
  });

  it("omits Reply-To and html when none is configured or given", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const notifier = createSmtpOutboundNotifier({ transport: { sendMail }, from: "orders@shop.example", logger: logger() });
    await notifier.send({ channel: "EMAIL", to: "a@b.example", subject: "s", body: "b" });
    expect(sendMail).toHaveBeenCalledWith({ from: "orders@shop.example", to: "a@b.example", subject: "s", text: "b" });
  });

  it("swallows a transport failure and logs only the template, the recipient DOMAIN and the error code", async () => {
    const failure = Object.assign(new Error("550 5.1.1 <customer@example.com>: Recipient address rejected, password-reset TOKEN-secret"), { code: "EENVELOPE", responseCode: 550 });
    const transport: MailTransport = { sendMail: vi.fn().mockRejectedValue(failure) };
    const log = logger();
    const notifier = createSmtpOutboundNotifier({ transport, from: "orders@shop.example", logger: log });

    await expect(notifier.send({ channel: "EMAIL", to: "customer@example.com", subject: "Reset", body: "TOKEN-secret", template: "password-reset" })).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
    const text = allLogs(log);
    expect(text).toContain("template=password-reset");
    expect(text).toContain("recipientDomain=example.com");
    expect(text).toContain("code=EENVELOPE");
    expect(text).not.toContain("customer@example.com");
    expect(text).not.toContain("TOKEN-secret");
    expect(text).not.toContain("Recipient address rejected");
  });

  it("swallows a non-Error rejection too", async () => {
    const transport: MailTransport = { sendMail: vi.fn().mockRejectedValue("boom") };
    const notifier = createSmtpOutboundNotifier({ transport, from: "orders@shop.example", logger: logger() });
    await expect(notifier.send({ channel: "EMAIL", to: "a@b.example", body: "x" })).resolves.toBeUndefined();
  });

  it("never logs the body, subject or html on success either", async () => {
    const log = logger();
    const notifier = createSmtpOutboundNotifier({ transport: { sendMail: vi.fn().mockResolvedValue({}) }, from: "orders@shop.example", logger: log });
    await notifier.send({ channel: "EMAIL", to: "customer@example.com", subject: "Secret subject", body: "TOKEN-abc", html: "<b>TOKEN-abc</b>", template: "verify-email" });
    const text = allLogs(log);
    expect(text).toContain("template=verify-email");
    expect(text).not.toContain("TOKEN-abc");
    expect(text).not.toContain("Secret subject");
    expect(text).not.toContain("customer@example.com");
  });

  it("does not attempt SMS over SMTP — it skips with a log line and does not throw", async () => {
    const sendMail = vi.fn();
    const log = logger();
    const notifier = createSmtpOutboundNotifier({ transport: { sendMail }, from: "orders@shop.example", logger: log });
    await expect(notifier.send({ channel: "SMS", to: "+201012345678", body: "x", template: "password-reset" })).resolves.toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("SKIPPED"));
  });
});
