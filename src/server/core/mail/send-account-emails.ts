import { NEWSLETTER_CONFIRMATION_TTL_MS } from "../../newsletter/confirmation.constants";
import { VERIFICATION_TOKEN_TTL_MS } from "../../shop/auth/customer-auth.constants";
import { STAFF_INVITE_TOKEN_TTL_MS } from "../auth/staff-auth.constants";
import { outboundNotifier } from "../notifications";
import { loadMailContext } from "./mail-context";
import { sendTemplatedEmail } from "./send-email";
import { newsletterConfirmationEmail, passwordResetEmail, staffInvitationEmail, verifyEmailEmail } from "./templates/auth-emails";
import { buildLink, type MailLocale } from "./templates/layout";

const minutes = (ms: number) => Math.round(ms / 60_000);

/** Emails a customer the link that confirms their address. The token is in the link only. */
export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  await sendTemplatedEmail({
    template: "verify-email",
    to,
    render: (ctx) => verifyEmailEmail({ locale: ctx.locale, storeName: ctx.storeName, token, expiresInMinutes: minutes(VERIFICATION_TOKEN_TTL_MS), storefrontUrl: ctx.storefrontUrl }),
  });
}

/**
 * Sends a customer their password-reset link: by email when they have an
 * address, otherwise as an SMS carrying the link alone (the SMTP transport skips
 * SMS, so today that reaches no one — the staff-assisted reset covers it).
 */
export async function sendPasswordResetMessage(contact: { email?: string; phone: string }, token: string): Promise<void> {
  if (contact.email) {
    await sendTemplatedEmail({
      template: "password-reset",
      to: contact.email,
      render: (ctx) => passwordResetEmail({ locale: ctx.locale, storeName: ctx.storeName, token, expiresInMinutes: minutes(VERIFICATION_TOKEN_TTL_MS), storefrontUrl: ctx.storefrontUrl }),
    });
    return;
  }
  try {
    const ctx = await loadMailContext();
    await outboundNotifier.send({ channel: "SMS", to: contact.phone, body: buildLink(ctx.storefrontUrl, `${ctx.locale}/reset-password`, { token }), template: "password-reset-sms" });
  } catch (error) {
    console.error(`[mail] could not send template=password-reset-sms: ${error instanceof Error ? error.name : "unknown error"}`);
  }
}

/** Emails a staff invitation. The console is English-only, so the invitation is too. */
export async function sendStaffInvitationEmail(to: string, inviteeName: string | undefined, token: string): Promise<void> {
  await sendTemplatedEmail({
    template: "staff-invitation",
    to,
    locale: "en",
    render: (ctx) => staffInvitationEmail({ locale: "en", storeName: ctx.storeName, token, expiresInMinutes: minutes(STAFF_INVITE_TOKEN_TTL_MS), backofficeUrl: ctx.backofficeUrl, inviteeName }),
  });
}

/** Emails the double opt-in link for a newsletter address, in the language the subscriber asked in. The token is in the link only. */
export async function sendNewsletterConfirmationEmail(to: string, token: string, locale: MailLocale): Promise<void> {
  await sendTemplatedEmail({
    template: "newsletter-confirm",
    to,
    locale,
    render: (ctx) => newsletterConfirmationEmail({ locale: ctx.locale, storeName: ctx.storeName, token, expiresInMinutes: minutes(NEWSLETTER_CONFIRMATION_TTL_MS), storefrontUrl: ctx.storefrontUrl }),
  });
}
