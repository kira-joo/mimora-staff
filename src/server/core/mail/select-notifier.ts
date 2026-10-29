import { createNoOpOutboundNotifier, type NotifierLogger, type OutboundNotifier } from "../../engines/notifications/outbound-notifier";
import { createSmtpOutboundNotifier, type MailTransport } from "../../engines/notifications/smtp-notifier";
import { mailConfigStatus, type MailConfig } from "./mail-config";

/**
 * Chooses the process's notifier from the environment: SMTP only when mail is
 * fully configured, the logging no-op otherwise — for both "off" and
 * "half-configured", because a half-built transport would fail on every send.
 * Boot says which of the three it is; this function only acts on it.
 *
 * `createTransport` is injected so the SMTP wiring is testable without a
 * network and without importing Nodemailer here.
 */
export function selectOutboundNotifier(
  env: Record<string, string | undefined>,
  deps: { createTransport: (config: MailConfig) => MailTransport; logger?: NotifierLogger }
): OutboundNotifier {
  const status = mailConfigStatus(env);
  if (status.state !== "configured") return createNoOpOutboundNotifier(deps.logger);
  return createSmtpOutboundNotifier({
    transport: deps.createTransport(status.config),
    from: status.config.from,
    replyTo: status.config.replyTo,
    logger: deps.logger,
  });
}
