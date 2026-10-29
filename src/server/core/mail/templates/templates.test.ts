import { describe, expect, it } from "vitest";
import { newsletterConfirmationEmail, passwordResetEmail, staffInvitationEmail, verifyEmailEmail } from "./auth-emails";
import { buildLink, durationPhrase, escapeHtml, oneLine, type MailLocale } from "./layout";
import { ORDER_EMAIL_KINDS, orderEmail, type OrderEmailInput } from "./order-emails";

const LOCALES: MailLocale[] = ["ar", "en"];
const TOKEN = "tkn_aB3dE5gH7jK9mN1pQ3sT5vW7yZ9-_";
const XSS = `<img src=x onerror="alert(1)">&"'`;

const auth = (locale: MailLocale, storeName = "Hirfa") => ({ locale, storeName, token: TOKEN, expiresInMinutes: 60, storefrontUrl: "https://shop.example" });

describe("account emails", () => {
  it.each(LOCALES)("verification email (%s): a link with ?token=, in the right language and direction, token not in the subject", (locale) => {
    const mail = verifyEmailEmail(auth(locale));
    const url = `https://shop.example/${locale}/verify-email?token=${TOKEN}`;
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.subject).not.toContain(TOKEN);
    expect(mail.subject).toContain("Hirfa");
    expect(mail.html).toContain(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`);
    expect(mail.text.length).toBeGreaterThan(20);
    expect(locale === "ar" ? /[؀-ۿ]/.test(mail.subject) : /^[\x00-\x7F—]+$/.test(mail.subject)).toBe(true);
  });

  it.each(LOCALES)("password reset email (%s): links to /reset-password?token=, token not in the subject", (locale) => {
    const mail = passwordResetEmail(auth(locale));
    expect(mail.text).toContain(`https://shop.example/${locale}/reset-password?token=${TOKEN}`);
    expect(mail.html).toContain(`/${locale}/reset-password?token=${TOKEN}`);
    expect(mail.subject).not.toContain(TOKEN);
    expect(mail.html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
  });

  it.each(LOCALES)("staff invitation (%s): links to the console's /accept-invite?token=", (locale) => {
    const mail = staffInvitationEmail({ locale, storeName: "Hirfa", token: TOKEN, expiresInMinutes: 60, backofficeUrl: "https://console.shop.example/", inviteeName: "Mona" });
    expect(mail.text).toContain(`https://console.shop.example/accept-invite?token=${TOKEN}`);
    expect(mail.html).toContain("Mona");
    expect(mail.subject).not.toContain(TOKEN);
  });

  it.each(LOCALES)("newsletter confirmation (%s): links to /newsletter/confirm?token=, token not in the subject, says nothing is subscribed yet", (locale) => {
    const mail = newsletterConfirmationEmail(auth(locale));
    const url = `https://shop.example/${locale}/newsletter/confirm?token=${TOKEN}`;
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.subject).not.toContain(TOKEN);
    expect(mail.html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
    expect(locale === "ar" ? /[؀-ۿ]/.test(mail.subject) : /^[\x00-\x7F—]+$/.test(mail.subject)).toBe(true);
  });

  it("an Arabic email carries Arabic text and the RTL wrapper on the table, not just the page", () => {
    const mail = verifyEmailEmail(auth("ar"));
    expect(mail.html).toMatch(/<table[^>]*dir="rtl"/);
    expect(mail.html).toContain("text-align:right");
    expect(mail.html).toContain("أكّد بريدك الإلكتروني");
  });

  it.each(LOCALES)("escapes a hostile store name in html (%s) and keeps it out of the subject's line structure", (locale) => {
    const mail = verifyEmailEmail(auth(locale, `${XSS}\r\nBcc: attacker@example.com`));
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it("the token is URL-encoded in the link, so odd characters cannot break out of the query", () => {
    const mail = passwordResetEmail({ ...auth("en"), token: "a b&c=d" });
    expect(mail.text).toContain("token=a+b%26c%3Dd");
  });

  it("the visible link and the href are both present (the button can fail; the text link cannot)", () => {
    const mail = verifyEmailEmail(auth("en"));
    const url = `https://shop.example/en/verify-email?token=${TOKEN}`;
    expect(mail.html.split(escapeHtml(url)).length - 1).toBeGreaterThanOrEqual(2);
  });
});

const order = (kind: OrderEmailInput["kind"], locale: MailLocale, overrides: Partial<OrderEmailInput> = {}): OrderEmailInput => ({
  kind,
  locale,
  storeName: "Hirfa",
  orderNumber: "ORD-1042",
  total: "EGP 250.00",
  ...overrides,
});

describe("order emails", () => {
  const cases = ORDER_EMAIL_KINDS.flatMap((kind) => LOCALES.map((locale) => [kind, locale] as const));

  it("covers ten kinds", () => {
    expect(ORDER_EMAIL_KINDS).toHaveLength(10);
  });

  it.each(LOCALES)("order-collected (%s) says collected, not delivered — it is a pickup message", (locale) => {
    const mail = orderEmail(order("order-collected", locale));
    expect(mail.subject).toContain("ORD-1042");
    if (locale === "en") {
      expect(mail.subject).toBe("Order ORD-1042 was collected");
      expect(mail.text).toContain("collected order ORD-1042");
      expect(mail.text.toLowerCase()).not.toContain("delivered");
    } else {
      expect(mail.text).toContain("استلمت طلبك رقم ORD-1042");
      expect(mail.text).not.toContain("توصيل");
    }
  });

  it.each(cases)("%s (%s): a subject with the order number, a text part, an html part, and the right direction", (kind, locale) => {
    const mail = orderEmail(order(kind, locale, { reason: "Blurry", refundAmount: "EGP 50.00", pickup: { name: "Main store", address: "1 Nile St" } }));
    expect(mail.subject).toContain("ORD-1042");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain("ORD-1042");
    expect(mail.html).toContain("ORD-1042");
    expect(mail.html).toContain(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`);
    if (locale === "ar") expect(mail.subject).toMatch(/[؀-ۿ]/);
    expect(mail.html).toMatch(/^<!doctype html>/);
  });

  it.each(cases)("%s (%s): never contains a token-shaped link — order emails carry no credential", (kind, locale) => {
    const mail = orderEmail(order(kind, locale));
    expect(mail.text + mail.html).not.toMatch(/token=/);
  });

  it.each(LOCALES)("payment-rejected (%s) shows the reason, escaped", (locale) => {
    const mail = orderEmail(order("payment-rejected", locale, { reason: XSS }));
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(mail.text).toContain(XSS); // plain text is not HTML: it is shown literally
  });

  it.each(LOCALES)("ready-for-pickup (%s) shows where to collect, escaped", (locale) => {
    const mail = orderEmail(order("order-ready-for-pickup", locale, { pickup: { name: `Shop <b>1</b>`, address: "1 Nile St & Co" } }));
    expect(mail.html).toContain("Shop &lt;b&gt;1&lt;/b&gt;");
    expect(mail.html).toContain("1 Nile St &amp; Co");
    expect(mail.html).not.toContain("<b>1</b>");
  });

  it.each(LOCALES)("escapes a hostile customer name, store name and contact email (%s)", (locale) => {
    const mail = orderEmail(order("order-placed", locale, { customerName: XSS, storeName: XSS, contactEmail: `a<script>@x.example` }));
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<script>");
  });

  it("refund-recorded shows the amount in both locales", () => {
    for (const locale of LOCALES) expect(orderEmail(order("refund-recorded", locale, { refundAmount: "EGP 50.00" })).text).toContain("EGP 50.00");
  });

  it("the cancellation email does not leak the cancellation reason (it may be internal)", () => {
    const mail = orderEmail(order("order-cancelled", "en", { reason: "fraud suspected" }));
    expect(mail.text + mail.html).not.toContain("fraud suspected");
  });

  it("an order email still renders when optional parts are absent", () => {
    expect(() => orderEmail(order("order-ready-for-pickup", "en"))).not.toThrow();
    expect(() => orderEmail(order("refund-recorded", "ar"))).not.toThrow();
  });
});

describe("layout helpers", () => {
  it("buildLink joins with one slash and never drops the base's own path", () => {
    expect(buildLink("https://shop.example/", "/ar/verify-email", { token: "x" })).toBe("https://shop.example/ar/verify-email?token=x");
    expect(buildLink("https://shop.example/store", "ar/verify-email", { token: "x" })).toBe("https://shop.example/store/ar/verify-email?token=x");
  });
  it("oneLine collapses newlines", () => {
    expect(oneLine("a\r\nb\n c")).toBe("a b c");
  });
  it("durationPhrase speaks both languages", () => {
    expect(durationPhrase(60, "en")).toBe("1 hour");
    expect(durationPhrase(120, "en")).toBe("2 hours");
    expect(durationPhrase(30, "en")).toBe("30 minutes");
    expect(durationPhrase(60, "ar")).toBe("ساعة واحدة");
    expect(durationPhrase(180, "ar")).toBe("3 ساعات");
    expect(durationPhrase(720, "ar")).toBe("12 ساعة");
    expect(durationPhrase(30, "ar")).toBe("30 دقيقة");
  });
});
