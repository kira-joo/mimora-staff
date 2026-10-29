import type { NotifierLogger, OutboundNotification, OutboundNotifier } from "./outbound-notifier";
import { maskRecipient, recipientDomain } from "./recipient";

/** The one method of a Nodemailer transporter this adapter uses — so the engine imports no mail library and a test passes a stub. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; replyTo?: string; subject: string; text: string; html?: string }): Promise<unknown>;
}

export interface SmtpNotifierOptions {
  transport: MailTransport;
  /** The `MAIL_FROM` value. */
  from: string;
  replyTo?: string;
  logger?: NotifierLogger;
}

/**
 * What of a transport failure is safe to log: Nodemailer's error `code` (`EAUTH`, `ECONNECTION`, …) and the SMTP
 * `responseCode` — and NOT `error.message`, which routinely embeds the rejected recipient address, nor `response`,
 * which can echo the message envelope.
 */
function describeFailure(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
  const parts = [typeof code === "string" ? `code=${code}` : "", typeof responseCode === "number" ? `smtp=${responseCode}` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "unknown";
}

/**
 * Delivers EMAIL notifications through an SMTP transport.
 *
 * **`send` never throws** (D-8: no flow may depend on delivery): a refused
 * connection, bad credentials or a rejected recipient is caught and logged as
 * the template name plus the recipient's DOMAIN — never the address, the
 * subject, the body, or the provider's error text. SMS is not something SMTP
 * can carry; it is skipped with a log line, never an error.
 */
export function createSmtpOutboundNotifier(options: SmtpNotifierOptions): OutboundNotifier {
  const logger = options.logger ?? console;

  return {
    async send(notification: OutboundNotification): Promise<void> {
      const template = notification.template ?? "(unnamed)";

      if (notification.channel !== "EMAIL") {
        logger.warn(`[outbound-notifier] SKIPPED — channel=${notification.channel} template=${template} is not carried by the SMTP transport.`);
        return;
      }

      try {
        await options.transport.sendMail({
          from: options.from,
          to: notification.to,
          ...(options.replyTo ? { replyTo: options.replyTo } : {}),
          subject: notification.subject ?? "",
          text: notification.body,
          ...(notification.html ? { html: notification.html } : {}),
        });
        logger.info(`[outbound-notifier] SENT — template=${template} to=${maskRecipient(notification.to)}`);
      } catch (error) {
        logger.warn(`[outbound-notifier] SEND FAILED — template=${template} recipientDomain=${recipientDomain(notification.to)} ${describeFailure(error)}`);
      }
    },
  };
}
