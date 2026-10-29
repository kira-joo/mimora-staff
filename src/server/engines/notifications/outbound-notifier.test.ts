import { describe, expect, it, vi } from "vitest";
import { createNoOpOutboundNotifier } from "./outbound-notifier";

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

describe("createNoOpOutboundNotifier", () => {
  it("does not announce at construction — the boot announcement owns that (a lazy, import-time warning is not boot)", () => {
    const logger = fakeLogger();
    createNoOpOutboundNotifier(logger);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs that a notification would have been sent: the template name and the MASKED recipient", async () => {
    const logger = fakeLogger();
    const notifier = createNoOpOutboundNotifier(logger);

    await notifier.send({ channel: "EMAIL", to: "customer@example.com", subject: "Order confirmed", body: "Thank you", template: "order-confirmed" });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const loggedMessage = logger.info.mock.calls[0]?.[0] as string;
    expect(loggedMessage).toContain("channel=EMAIL");
    expect(loggedMessage).toContain("template=order-confirmed");
    expect(loggedMessage).toContain("c***@example.com");
    expect(loggedMessage).not.toContain("customer@example.com");
  });

  // This test fails on the first version, which interpolated `body="${notification.body}"` into the log line.
  it("never logs a token, the body, the html or the subject — a reset token in a log is a working credential", async () => {
    const logger = fakeLogger();
    const notifier = createNoOpOutboundNotifier(logger);
    const token = "TOKEN-aB3dE5gH7jK9mN1pQ3sT5vW7yZ9";

    await notifier.send({
      channel: "EMAIL",
      to: "customer@example.com",
      subject: `Reset your password ${token}`,
      body: `Your password reset token: ${token}`,
      html: `<a href="https://shop.example/ar/reset-password?token=${token}">reset</a>`,
      template: "password-reset",
    });

    const everything = [...logger.info.mock.calls, ...logger.warn.mock.calls].flat().join("\n");
    expect(everything).not.toContain(token);
    expect(everything).not.toContain("reset-password?token");
    expect(everything).not.toContain("Reset your password");
  });

  it("never throws — no engine or flow may depend on delivery", async () => {
    const notifier = createNoOpOutboundNotifier(fakeLogger());
    await expect(notifier.send({ channel: "SMS", to: "+201000000000", body: "" })).resolves.toBeUndefined();
  });

  it("copes with an unnamed notification and an SMS recipient", async () => {
    const logger = fakeLogger();
    const notifier = createNoOpOutboundNotifier(logger);
    await notifier.send({ channel: "SMS", to: "+201012345678", body: "Your order shipped" });

    const loggedMessage = logger.info.mock.calls[0]?.[0] as string;
    expect(loggedMessage).toContain("template=(unnamed)");
    expect(loggedMessage).not.toContain("+201012345678");
    expect(loggedMessage).not.toContain("Your order shipped");
  });
});
