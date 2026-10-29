import { describe, expect, it, vi } from "vitest";
import type { MailTransport } from "../../engines/notifications/smtp-notifier";
import { selectOutboundNotifier } from "./select-notifier";

const FULL = {
  SMTP_HOST: "smtp.provider.example",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASS: "not-a-real-password",
  MAIL_FROM: "orders@shop.example",
  STOREFRONT_URL: "https://shop.example",
  BACKOFFICE_URL: "https://console.shop.example",
};

function harness(env: Record<string, string | undefined>) {
  const sendMail = vi.fn().mockResolvedValue({});
  const transport: MailTransport = { sendMail };
  const createTransport = vi.fn().mockReturnValue(transport);
  const logger = { warn: vi.fn(), info: vi.fn() };
  const notifier = selectOutboundNotifier(env, { createTransport, logger });
  return { notifier, sendMail, createTransport, logger };
}

describe("selectOutboundNotifier", () => {
  it("all mail variables set: the SMTP adapter, over a transport built from that configuration", async () => {
    const { notifier, sendMail, createTransport } = harness(FULL);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.provider.example", port: 587, requireTLS: true }));
    await notifier.send({ channel: "EMAIL", to: "a@b.example", subject: "s", body: "b", template: "t" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "orders@shop.example", to: "a@b.example" }));
  });

  it("none set: the no-op — no transport is ever built and nothing is sent", async () => {
    const { notifier, sendMail, createTransport, logger } = harness({});
    await notifier.send({ channel: "EMAIL", to: "a@b.example", subject: "s", body: "b", template: "t" });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("NOOP"));
  });

  it("partially set: the no-op too — a half-built transport would fail on every send", async () => {
    const { notifier, sendMail, createTransport } = harness({ ...FULL, MAIL_FROM: undefined });
    await notifier.send({ channel: "EMAIL", to: "a@b.example", subject: "s", body: "b", template: "t" });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("SMTP configured but STOREFRONT_URL missing: the no-op (links could not be built)", async () => {
    const { notifier, sendMail } = harness({ ...FULL, STOREFRONT_URL: undefined });
    await notifier.send({ channel: "EMAIL", to: "a@b.example", subject: "s", body: "b" });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
