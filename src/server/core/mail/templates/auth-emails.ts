import { buildLink, durationPhrase, oneLine, renderEmailHtml, renderEmailText, type EmailContent, type MailLocale, type RenderedEmail } from "./layout";

/**
 * The three account emails: verify an email address, reset a password, accept
 * a staff invitation. Each is ONE function returning `{ subject, text, html }`.
 *
 * **The token is only ever in the link** (text and html bodies). Never in the
 * subject: subjects appear in notification banners, lock screens, and mail
 * lists, and are indexed and logged by more systems than bodies are.
 *
 * Link formats are the contract with the pages that read them — the storefront's
 * `/{locale}/verify-email?token=` and `/{locale}/reset-password?token=`, and the
 * console's `/accept-invite?token=` — each reads `?token=` (verified in
 * `store-platform/src/components/auth/token-forms.tsx` and
 * `features/auth/accept-invite-form.tsx`).
 */

interface Base {
  locale: MailLocale;
  /** Already resolved to `locale`. */
  storeName: string;
  /** The single-use plaintext token. */
  token: string;
  /** How long the link works. */
  expiresInMinutes: number;
}

export interface StorefrontLinkInput extends Base {
  /** `STOREFRONT_URL`. */
  storefrontUrl: string;
}

export interface StaffInvitationInput extends Base {
  /** `BACKOFFICE_URL`. */
  backofficeUrl: string;
  inviteeName?: string;
}

function finish(subject: string, content: EmailContent): RenderedEmail {
  return { subject: oneLine(subject), text: renderEmailText(content), html: renderEmailHtml(content) };
}

export function verifyEmailEmail(input: StorefrontLinkInput): RenderedEmail {
  const url = buildLink(input.storefrontUrl, `${input.locale}/verify-email`, { token: input.token });
  const validity = durationPhrase(input.expiresInMinutes, input.locale);
  const ar = input.locale === "ar";
  return finish(ar ? `تأكيد بريدك الإلكتروني في ${input.storeName}` : `Confirm your email address — ${input.storeName}`, {
    locale: input.locale,
    storeName: input.storeName,
    heading: ar ? "أكّد بريدك الإلكتروني" : "Confirm your email address",
    paragraphs: [
      ar ? `شكرًا لتسجيلك في ${input.storeName}. اضغط على الزر أدناه لتأكيد بريدك الإلكتروني.` : `Thanks for signing up with ${input.storeName}. Use the button below to confirm your email address.`,
      ar ? `هذا الرابط صالح لمدة ${validity}.` : `This link is valid for ${validity}.`,
    ],
    action: { label: ar ? "تأكيد البريد الإلكتروني" : "Confirm email address", url },
    linkFallbackLabel: ar ? "إذا لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:" : "If the button does not work, copy this link into your browser:",
    footnotes: [ar ? "إذا لم تنشئ حسابًا لدينا، تجاهل هذه الرسالة." : "If you did not create an account, you can ignore this message."],
  });
}

export function passwordResetEmail(input: StorefrontLinkInput): RenderedEmail {
  const url = buildLink(input.storefrontUrl, `${input.locale}/reset-password`, { token: input.token });
  const validity = durationPhrase(input.expiresInMinutes, input.locale);
  const ar = input.locale === "ar";
  return finish(ar ? `إعادة تعيين كلمة المرور — ${input.storeName}` : `Reset your password — ${input.storeName}`, {
    locale: input.locale,
    storeName: input.storeName,
    heading: ar ? "إعادة تعيين كلمة المرور" : "Reset your password",
    paragraphs: [
      ar ? `تلقّينا طلبًا لإعادة تعيين كلمة المرور لحسابك في ${input.storeName}. اضغط على الزر أدناه لاختيار كلمة مرور جديدة.` : `We received a request to reset the password for your ${input.storeName} account. Use the button below to choose a new one.`,
      ar ? `هذا الرابط صالح لمدة ${validity}.` : `This link is valid for ${validity}.`,
    ],
    action: { label: ar ? "إعادة تعيين كلمة المرور" : "Reset password", url },
    linkFallbackLabel: ar ? "إذا لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:" : "If the button does not work, copy this link into your browser:",
    footnotes: [ar ? "إذا لم تطلب ذلك، تجاهل هذه الرسالة؛ لن يتغيّر شيء في حسابك." : "If you did not ask for this, ignore this message — nothing about your account will change."],
  });
}

/** The double opt-in message: nothing is subscribed until the recipient follows the link. */
export function newsletterConfirmationEmail(input: StorefrontLinkInput): RenderedEmail {
  const url = buildLink(input.storefrontUrl, `${input.locale}/newsletter/confirm`, { token: input.token });
  const validity = durationPhrase(input.expiresInMinutes, input.locale);
  const ar = input.locale === "ar";
  return finish(ar ? `أكّد اشتراكك في نشرة ${input.storeName}` : `Confirm your subscription — ${input.storeName}`, {
    locale: input.locale,
    storeName: input.storeName,
    heading: ar ? "أكّد اشتراكك في النشرة" : "Confirm your subscription",
    paragraphs: [
      ar ? `طلب أحدهم الاشتراك بهذا البريد في نشرة ${input.storeName}. اضغط على الزر أدناه لتأكيد اشتراكك؛ لن نراسلك قبل ذلك.` : `Someone asked to subscribe this address to the ${input.storeName} newsletter. Use the button below to confirm — we will not write to you before you do.`,
      ar ? `هذا الرابط صالح لمدة ${validity}.` : `This link is valid for ${validity}.`,
    ],
    action: { label: ar ? "تأكيد الاشتراك" : "Confirm subscription", url },
    linkFallbackLabel: ar ? "إذا لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:" : "If the button does not work, copy this link into your browser:",
    footnotes: [ar ? "إذا لم تطلب ذلك، تجاهل هذه الرسالة وسيبقى بريدك غير مشترك." : "If you did not ask for this, ignore this message and your address stays unsubscribed."],
  });
}

export function staffInvitationEmail(input: StaffInvitationInput): RenderedEmail {
  const url = buildLink(input.backofficeUrl, "accept-invite", { token: input.token });
  const validity = durationPhrase(input.expiresInMinutes, input.locale);
  const ar = input.locale === "ar";
  const greeting = input.inviteeName ? (ar ? `مرحبًا ${input.inviteeName}،` : `Hello ${input.inviteeName},`) : undefined;
  return finish(ar ? `دعوة للانضمام إلى فريق ${input.storeName}` : `You have been invited to join ${input.storeName}`, {
    locale: input.locale,
    storeName: input.storeName,
    heading: ar ? "تمت دعوتك للانضمام" : "You have been invited",
    paragraphs: [
      ...(greeting ? [greeting] : []),
      ar ? `تمت دعوتك للانضمام إلى فريق ${input.storeName}. اضغط على الزر أدناه لاختيار كلمة مرور وتفعيل حسابك.` : `You have been invited to join the ${input.storeName} team. Use the button below to choose a password and activate your account.`,
      ar ? `هذا الرابط صالح لمدة ${validity}.` : `This invitation is valid for ${validity}.`,
    ],
    action: { label: ar ? "قبول الدعوة" : "Accept invitation", url },
    linkFallbackLabel: ar ? "إذا لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:" : "If the button does not work, copy this link into your browser:",
    footnotes: [ar ? "إذا لم تكن تتوقع هذه الدعوة، تجاهل هذه الرسالة." : "If you were not expecting this invitation, ignore this message."],
  });
}
