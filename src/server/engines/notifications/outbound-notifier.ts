import { maskRecipient } from "./recipient";

export type NotificationChannel = "EMAIL" | "SMS";

export interface OutboundNotification {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  /** The plain-text body. For an email it is the `text/plain` alternative to `html`. */
  body: string;
  /** Email only: the HTML alternative of the same message. Ignored by a plain-text channel. */
  html?: string;
  /**
   * The message's template name (`"password-reset"`, `"order-shipped"`, …). This is the ONLY description of
   * what a notification is that may be logged: the body carries tokens and personal data, the name carries neither.
   */
  template?: string;
}

/**
 * One interface for every outbound notification this platform ever sends.
 * D-8: delivery is an optional capability, and **no engine or flow may depend on
 * delivery** — `send` always resolves, never throws, so a caller can fire a
 * notification and move on without its own flow gating on whether it
 * actually reached anyone.
 */
export interface OutboundNotifier {
  send(notification: OutboundNotification): Promise<void>;
}

export interface NotifierLogger {
  warn(message: string): void;
  info(message: string): void;
}

/**
 * The no-op implementation, used while no transport is configured. It logs
 * THAT a notification would have been sent — the template name and the masked
 * recipient — and nothing else: never the body, the subject or the html, which
 * carry reset and verification tokens and customer data. (The first version
 * logged the body; every password-reset token went into the log stream.)
 *
 * It does not announce itself. "Configured OFF must be loud, once, at startup"
 * is the boot announcement's job (`src/instrumentation.ts`, from
 * `core/mail/mail-config.ts`) — an announcement made at construction fires
 * lazily on whichever module happens to be imported first, which is not boot.
 */
export function createNoOpOutboundNotifier(logger: NotifierLogger = console): OutboundNotifier {
  return {
    async send(notification: OutboundNotification): Promise<void> {
      logger.info(
        `[outbound-notifier] NOOP send — channel=${notification.channel} template=${notification.template ?? "(unnamed)"} to=${maskRecipient(notification.to)}`
      );
    },
  };
}
