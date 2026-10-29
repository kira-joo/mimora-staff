import type { LocalizedString } from "@kira-joo/toolkit-common";
import { LEGAL_PAGE_SLUGS } from "./legal-pages";

/**
 * Starting drafts for the seven legal pages — owner instruction: legal text is
 * integrated as clearly marked DRAFTS requiring owner review, never as final.
 *
 * Source: `store-platform/docs/legal-and-consent.md` §1 (titles) and §6 (the
 * openings of terms, privacy, returns and cookies — English as written there,
 * Arabic translated here because Arabic is the default locale and a page cannot
 * be published without it, D-11). Where that document gives no copy
 * (shipping, accessibility, contact) the body is a structured placeholder whose
 * `[BRACKETED]` fields the owner fills in.
 *
 * Every body STARTS with the draft marker, in both languages. It is part of the
 * text on purpose: a page published by mistake shows customers a visible
 * "draft" notice instead of passing unreviewed text off as final, and the
 * console flags any page still carrying it (`containsDraftMarker`).
 *
 * Bodies are plain text, paragraphs separated by a blank line — the storefront
 * renders them as paragraphs, never as HTML.
 */
export const LEGAL_DRAFT_MARKER: LocalizedString = {
  ar: "مسودة — تتطلب مراجعة المالك والجهة القانونية قبل النشر",
  en: "DRAFT — requires owner/legal review before publishing",
};

export interface LegalPageDraft {
  slug: (typeof LEGAL_PAGE_SLUGS)[number];
  title: LocalizedString;
  /** Includes the draft marker as its first paragraph. */
  content: LocalizedString;
}

const withMarker = (body: LocalizedString): LocalizedString => ({
  ar: `${LEGAL_DRAFT_MARKER.ar}\n\n${body.ar}`,
  en: `${LEGAL_DRAFT_MARKER.en}\n\n${body.en}`,
});

const BODIES: Record<LegalPageDraft["slug"], { title: LocalizedString; body: LocalizedString }> = {
  terms: {
    title: { ar: "شروط البيع", en: "Terms of Sale" },
    body: {
      ar: [
        "تسري هذه الشروط على كل طلب يتم عبر هذا المتجر. بإتمام الطلب فأنت توافق عليها. يجوز لنا تعديلها، والشروط التي تسري على طلبك هي التي وافقت عليها وقت إتمامه.",
        "الأسعار معروضة بعملة [العملة] وتشمل [المعاملة الضريبية]. السعر الذي تدفعه هو السعر المعروض عند إتمام الطلب.",
        "التوفر. قد لا نتمكن من تنفيذ طلب إذا نفد صنف بين وقت طلبك وتأكيدنا. في هذه الحالة سنتواصل معك ونرد إليك أي مبلغ تم دفعه.",
        "[الهوية القانونية للتاجر: الاسم التجاري والعنوان المسجل ورقم السجل التجاري أو الضريبي]",
      ].join("\n\n"),
      en: [
        "These terms apply to every order placed through this store. By placing an order you agree to them. We may change them, and the terms that apply to your order are the ones you accepted when you placed it.",
        "Prices are shown in [CURRENCY] and include [TAX TREATMENT]. The price you pay is the price shown at checkout when your order is placed.",
        "Availability. We may be unable to fulfil an order if an item sells out between your order and our confirmation. If that happens we will contact you and refund anything already paid.",
        "[MERCHANT LEGAL IDENTITY: trading name, registered address, commercial registration or tax number]",
      ].join("\n\n"),
    },
  },
  privacy: {
    title: { ar: "سياسة الخصوصية", en: "Privacy Policy" },
    body: {
      ar: [
        "نجمع ما نحتاجه لنبيعك ونوصّل إليك. لا نبيع بياناتك، ولا نشاركها لأغراض الإعلان، ولا نتتبعك عبر مواقع أخرى.",
        "البيانات التي نجمعها: رقم الهاتف (معرّف الدخول وطريقة التوصيل)، الاسم، البريد الإلكتروني (اختياري)، عنوان التوصيل، سجل الطلبات، صورة إثبات الدفع، وموافقة التسويق. [الغرض وفترة الاحتفاظ لكل بند — تحدد بعد المراجعة القانونية]",
        "الحذف. يمكنك طلب إغلاق حسابك. يُغلق الحساب وتُحذف بيانات الدخول وتُحجب المعرّفات الشخصية، أما الطلبات السابقة فتبقى بلقطتها الأصلية لأن السجلات المالية يجب الاحتفاظ بها.",
      ].join("\n\n"),
      en: [
        "We collect what we need to sell you something and deliver it. We do not sell your data, we do not share it for advertising, and we do not track you across other sites.",
        "What we collect: phone number (login and delivery), name, email (optional), delivery address, order history, payment proof image, and marketing consent. [PURPOSE AND RETENTION PERIOD FOR EACH ITEM — to be set after legal review]",
        "Deletion. You can ask us to close your account. The account is closed, credentials are destroyed and personal identifiers are redacted; past orders remain with their original snapshot because financial records must be kept.",
      ].join("\n\n"),
    },
  },
  returns: {
    title: { ar: "الإرجاع والاسترداد", en: "Returns & Refunds" },
    body: {
      ar: [
        "يمكنك إرجاع صنف خلال [مدة الإرجاع] يومًا من التسليم، بشرط أن يكون غير مستخدم وبحالته الأصلية. بعض الأصناف لا يمكن إرجاعها لأسباب صحية، وتُعلَّم هذه الأصناف في صفحة المنتج.",
        "كيفية الإرجاع: [خطوات طلب الإرجاع]",
        "الاسترداد: [طريقة الاسترداد ومدته]",
      ].join("\n\n"),
      en: [
        "You may return an item within [RETURN WINDOW] days of delivery, provided it is unused and in its original condition. Some items cannot be returned for hygiene reasons; these are marked on the product page.",
        "How to return: [STEPS TO REQUEST A RETURN]",
        "Refunds: [REFUND METHOD AND TIMING]",
      ].join("\n\n"),
    },
  },
  shipping: {
    title: { ar: "التوصيل والاستلام", en: "Delivery & Collection" },
    body: {
      ar: ["مناطق التوصيل: [المناطق المخدومة]", "رسوم التوصيل ومدته: [الرسوم وأوقات التسليم المتوقعة]", "الاستلام من الفرع: [أماكن الاستلام وساعات العمل]"].join("\n\n"),
      en: ["Delivery zones: [ZONES SERVED]", "Delivery fees and lead times: [FEES AND EXPECTED DELIVERY TIMES]", "Collection: [PICKUP LOCATIONS AND OPENING HOURS]"].join("\n\n"),
    },
  },
  cookies: {
    title: { ar: "ملفات تعريف الارتباط والتخزين", en: "Cookies & Storage" },
    body: {
      ar: [
        "يخزّن هذا الموقع قدرًا قليلًا من المعلومات في متصفحك. معظمها ما يُبقيك مسجّل الدخول ويحفظ سلتك، ومن دونه لا يعمل المتجر. لا نستخدم ملفات تعريف ارتباط إعلانية.",
        "ما يُخزَّن: ملفات الجلسة (ضرورية)، سلة الزائر (ضرورية)، اختيار المظهر واللغة (تفضيلات)، والتحليلات (بموافقتك إن كانت تحدّد هويتك). [تُراجع هذه القائمة قانونيًا]",
      ].join("\n\n"),
      en: [
        "This site stores a small amount of information in your browser. Most of it is what keeps you signed in and keeps your cart — without it the store does not work. We do not use advertising cookies.",
        "What is stored: session cookies (necessary), guest cart (necessary), theme and language choice (preferences), and analytics (with your consent if it identifies you). [THIS LIST TO BE REVIEWED LEGALLY]",
      ].join("\n\n"),
    },
  },
  accessibility: {
    title: { ar: "إمكانية الوصول", en: "Accessibility" },
    body: {
      ar: ["المعيار الذي نسعى إليه: [المعيار]", "للإبلاغ عن عائق أو طلب مساعدة: [وسيلة التواصل]"].join("\n\n"),
      en: ["The standard we aim for: [STANDARD]", "To report a barrier or ask for help: [CONTACT METHOD]"].join("\n\n"),
    },
  },
  contact: {
    title: { ar: "اتصل بنا", en: "Contact" },
    body: {
      ar: ["الاسم التجاري: [الاسم]", "العنوان المسجل: [العنوان]", "السجل التجاري أو الرقم الضريبي: [الرقم]", "الهاتف والبريد الإلكتروني: [وسائل التواصل]"].join("\n\n"),
      en: ["Trading name: [NAME]", "Registered address: [ADDRESS]", "Commercial registration or tax number: [NUMBER]", "Phone and email: [CONTACT DETAILS]"].join("\n\n"),
    },
  },
};

/** The drafts in the order `legal-and-consent.md` §1 lists them. */
export const LEGAL_PAGE_DRAFTS: LegalPageDraft[] = LEGAL_PAGE_SLUGS.map((slug) => ({ slug, title: BODIES[slug].title, content: withMarker(BODIES[slug].body) }));

/** Whether a page's text still carries the draft marker in either locale — i.e. nobody has reviewed and cleared it. */
export function containsDraftMarker(content: Partial<LocalizedString> | undefined): boolean {
  if (!content) return false;
  return (content.ar ?? "").includes(LEGAL_DRAFT_MARKER.ar) || (content.en ?? "").includes(LEGAL_DRAFT_MARKER.en);
}
