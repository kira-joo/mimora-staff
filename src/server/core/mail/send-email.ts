import { outboundNotifier } from "../notifications";
import { loadMailContext, type MailContext } from "./mail-context";
import type { MailLocale, RenderedEmail } from "./templates/layout";

export interface TemplatedEmail {
  /** The template's name, the only thing about the message that may be logged. */
  template: string;
  to: string;
  /** The recipient's own language; absent means the store profile's default. */
  locale?: MailLocale;
  render: (context: MailContext) => RenderedEmail;
}

/**
 * Renders a template against the store's identity and hands it to the process's
 * notifier.
 *
 * **Never throws**, and not only because `send` doesn't: loading the store
 * profile or rendering can fail too, and none of it may fail the flow that asked
 * for the email (a signup, a password reset, an order transition). The error's
 * name is logged with the template name; never its message.
 */
export async function sendTemplatedEmail(email: TemplatedEmail): Promise<void> {
  try {
    const context = await loadMailContext(email.locale);
    const rendered = email.render(context);
    await outboundNotifier.send({ channel: "EMAIL", to: email.to, subject: rendered.subject, body: rendered.text, html: rendered.html, template: email.template });
  } catch (error) {
    console.error(`[mail] could not send template=${email.template}: ${error instanceof Error ? error.name : "unknown error"}`);
  }
}
