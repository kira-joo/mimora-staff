import { oneLine, renderEmailHtml, renderEmailText, type EmailContent, type MailLocale, type RenderedEmail } from "./layout";

/**
 * Order lifecycle emails to the customer. One function, one `kind` per message.
 * Money arrives already formatted (`moneyView(currency, locale)` at the call
 * site) — a template never touches a number — and every merchant or customer
 * string is escaped by the layout.
 *
 * No tracking link: a guest's order page needs a token this email does not
 * carry, and a link that works for some recipients is worse than none.
 */
export type OrderEmailKind =
  | "order-placed"
  | "order-confirmed"
  | "payment-verified"
  | "payment-rejected"
  | "order-shipped"
  | "order-ready-for-pickup"
  | "order-collected"
  | "order-delivered"
  | "order-cancelled"
  | "refund-recorded";

export const ORDER_EMAIL_KINDS: readonly OrderEmailKind[] = [
  "order-placed",
  "order-confirmed",
  "payment-verified",
  "payment-rejected",
  "order-shipped",
  "order-ready-for-pickup",
  "order-collected",
  "order-delivered",
  "order-cancelled",
  "refund-recorded",
];

export interface OrderEmailInput {
  kind: OrderEmailKind;
  locale: MailLocale;
  storeName: string;
  orderNumber: string;
  customerName?: string;
  /** Formatted order total, e.g. "EGP 250.00". */
  total: string;
  /** `payment-rejected`: the reason staff gave — shown to the customer by design (the storefront shows it too). */
  reason?: string;
  /** `refund-recorded`: the formatted refunded amount. */
  refundAmount?: string;
  /** `order-ready-for-pickup`: where to collect. */
  pickup?: { name: string; address: string };
  /** The store's contact email, for the footer. */
  contactEmail?: string;
}

interface Copy {
  subject: string;
  heading: string;
  lead: string;
  extra?: string[];
}

function copyFor(input: OrderEmailInput): Copy {
  const n = input.orderNumber;
  const ar = input.locale === "ar";
  switch (input.kind) {
    case "order-placed":
      return ar
        ? { subject: `استلمنا طلبك رقم ${n}`, heading: "شكرًا لطلبك", lead: `استلمنا طلبك رقم ${n} بقيمة ${input.total}. سنوافيك بأي تحديث على حالته.` }
        : { subject: `We received your order ${n}`, heading: "Thank you for your order", lead: `We have received order ${n} (${input.total}). We will keep you posted as it progresses.` };
    case "order-confirmed":
      return ar
        ? { subject: `تم تأكيد طلبك رقم ${n}`, heading: "تم تأكيد طلبك", lead: `أكّدنا طلبك رقم ${n} ونعمل على تجهيزه.` }
        : { subject: `Your order ${n} is confirmed`, heading: "Your order is confirmed", lead: `We have confirmed order ${n} and are getting it ready.` };
    case "payment-verified":
      return ar
        ? { subject: `تم استلام دفعتك للطلب رقم ${n}`, heading: "تم استلام دفعتك", lead: `تحققنا من دفعتك للطلب رقم ${n}. شكرًا لك.` }
        : { subject: `Payment received for order ${n}`, heading: "We received your payment", lead: `We have verified your payment for order ${n}. Thank you.` };
    case "payment-rejected":
      return ar
        ? {
            subject: `تعذّر التحقق من دفعتك للطلب رقم ${n}`,
            heading: "تعذّر التحقق من الدفع",
            lead: `لم نتمكن من التحقق من إثبات الدفع للطلب رقم ${n}.`,
            extra: ["يرجى رفع إيصال جديد من صفحة طلبك."],
          }
        : {
            subject: `We could not verify your payment for order ${n}`,
            heading: "We could not verify your payment",
            lead: `We could not verify the payment proof for order ${n}.`,
            extra: ["Please upload a new receipt from your order page."],
          };
    case "order-shipped":
      return ar
        ? { subject: `طلبك رقم ${n} في الطريق إليك`, heading: "طلبك في الطريق", lead: `خرج طلبك رقم ${n} للتوصيل.` }
        : { subject: `Order ${n} is on its way`, heading: "Your order is on its way", lead: `Your order ${n} has been sent out for delivery.` };
    case "order-ready-for-pickup":
      return ar
        ? { subject: `طلبك رقم ${n} جاهز للاستلام`, heading: "طلبك جاهز للاستلام", lead: `طلبك رقم ${n} جاهز للاستلام.` }
        : { subject: `Order ${n} is ready for pickup`, heading: "Your order is ready for pickup", lead: `Your order ${n} is ready for you to collect.` };
    case "order-collected":
      // Pickup's last step. Not "delivered": nothing was delivered, and a pickup customer told so would doubt the message.
      return ar
        ? { subject: `تم استلام طلبك رقم ${n} من المتجر`, heading: "تم تسليم طلبك لك عند الاستلام", lead: `سجّلنا أنك استلمت طلبك رقم ${n} من المتجر. شكرًا لتسوقك معنا.` }
        : { subject: `Order ${n} was collected`, heading: "Thanks for collecting your order", lead: `We have recorded that you collected order ${n}. Thank you for shopping with us.` };
    case "order-delivered":
      return ar
        ? { subject: `تم تسليم طلبك رقم ${n}`, heading: "تم تسليم طلبك", lead: `تم تسليم طلبك رقم ${n}. نتمنى أن ينال إعجابك.` }
        : { subject: `Order ${n} was delivered`, heading: "Your order was delivered", lead: `Your order ${n} has been delivered. We hope you enjoy it.` };
    case "order-cancelled":
      return ar
        ? { subject: `تم إلغاء طلبك رقم ${n}`, heading: "تم إلغاء طلبك", lead: `تم إلغاء طلبك رقم ${n}.`, extra: ["إذا كنت قد دفعت، سيصلك تأكيد منفصل بأي استرداد."] }
        : { subject: `Order ${n} was cancelled`, heading: "Your order was cancelled", lead: `Your order ${n} has been cancelled.`, extra: ["If you already paid, any refund will be confirmed to you separately."] };
    case "refund-recorded":
      return ar
        ? {
            subject: `تم تسجيل استرداد للطلب رقم ${n}`,
            heading: "تم تسجيل الاسترداد",
            lead: input.refundAmount ? `سجّلنا استرداد مبلغ ${input.refundAmount} للطلب رقم ${n}.` : `سجّلنا استرداد للطلب رقم ${n}.`,
            extra: ["قد يستغرق ظهوره في حسابك بعض الوقت."],
          }
        : {
            subject: `Refund recorded for order ${n}`,
            heading: "Your refund was recorded",
            lead: `We have recorded a refund${input.refundAmount ? ` of ${input.refundAmount}` : ""} for order ${n}.`,
            extra: ["It can take a little while to appear with your bank or wallet."],
          };
  }
}

export function orderEmail(input: OrderEmailInput): RenderedEmail {
  const ar = input.locale === "ar";
  const copy = copyFor(input);
  const details: NonNullable<EmailContent["details"]> = [{ label: ar ? "رقم الطلب" : "Order number", value: input.orderNumber }];
  if (input.kind === "payment-rejected" && input.reason) details.push({ label: ar ? "السبب" : "Reason", value: input.reason });
  if (input.kind === "order-ready-for-pickup" && input.pickup) {
    details.push({ label: ar ? "مكان الاستلام" : "Pick up at", value: input.pickup.name }, { label: ar ? "العنوان" : "Address", value: input.pickup.address });
  }
  if (input.kind === "refund-recorded" && input.refundAmount) details.push({ label: ar ? "المبلغ المسترد" : "Refunded amount", value: input.refundAmount });

  const content: EmailContent = {
    locale: input.locale,
    storeName: input.storeName,
    heading: copy.heading,
    paragraphs: [...(input.customerName ? [ar ? `مرحبًا ${input.customerName}،` : `Hello ${input.customerName},`] : []), copy.lead, ...(copy.extra ?? [])],
    details,
    footnotes: [
      ...(input.contactEmail ? [ar ? `للاستفسار تواصل معنا على ${input.contactEmail}.` : `Questions? Contact us at ${input.contactEmail}.`] : []),
      ar ? "هذه رسالة آلية." : "This is an automated message.",
    ],
  };
  return { subject: oneLine(copy.subject), text: renderEmailText(content), html: renderEmailHtml(content) };
}
