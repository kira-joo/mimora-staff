import nodemailer from "nodemailer";
import type { MailTransport } from "../../engines/notifications/smtp-notifier";
import type { MailConfig } from "./mail-config";

/**
 * A pooled Nodemailer SMTP transport: connections are kept and reused, so a burst of order emails does not
 * open a TCP+TLS session per message. Creating it opens nothing — the first connection happens on the first send —
 * so building it at module level (`core/notifications.ts`) costs nothing at import.
 */
export function createSmtpTransport(config: MailConfig): MailTransport {
  return nodemailer.createTransport({
    pool: true,
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    // Nodemailer's defaults wait up to 2 minutes to connect; a mail server that hangs must not hold a checkout response that long.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
  });
}
