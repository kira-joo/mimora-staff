// Store B: "Qahwa & Co", an invented Riyadh home-and-kitchen merchant, DELIBERATELY unlike store A so a storefront
// that only works for A fails here. It exercises: SAR, a low-contrast brand that the backend must darken, dark default
// ground with no visitor choice, contemporary typography, delivery-only with a flat fee and an order minimum,
// tax-included, mandatory sign-in at checkout, NO cash on delivery (proof-based transfers only), a tiny catalogue with a
// product without images, without axes, with one axis, sold out entirely, low stock and a sale price, no size guide,
// no coded promotion. The shared preview photos are tool-themed; they stand in as placeholders for QA only.
import { L, OK, OUT, LOW, axis, single, spec, cross, mk } from "./_builders.mjs";

const store = {
  name: L("Qahwa & Co", "قهوة وشركاه"),
  tagline: L("Slow coffee and everyday kitchen things", "قهوة بطيئة وأدوات مطبخ لكل يوم"),
  description: L(
    "Qahwa & Co is a Riyadh home-and-kitchen shop built around the morning cup: enamel kettles, ceramic drippers, copper cezves and the table linen to set them on.",
    "قهوة وشركاه متجر منزلي ومطبخي في الرياض يدور حول فنجان الصباح: غلايات مطلية بالمينا، ومقطّرات سيراميك، وجِزَوات نحاسية، وأقمشة المائدة التي تُوضع عليها."
  ),
  heroMedia: "story-craft",
  ogImage: "category-apparel",
  contact: { phone: "+966 11 555 0188", email: "salam@qahwa-co.example", whatsApp: "+966115550188" },
  socialLinks: [
    { platform: "instagram", url: "https://instagram.com/qahwa.and.co" },
    { platform: "snapchat", url: "https://snapchat.com/add/qahwa.and.co" },
    { platform: "x", url: "https://x.com/qahwa_and_co" },
  ],
  currency: "SAR",
  defaultLocale: "ar",
  supportedLocales: ["ar", "en"],
  defaultSeo: {
    title: L("Qahwa & Co | Coffee gear and kitchen goods", "قهوة وشركاه | أدوات القهوة والمطبخ"),
    description: L("Enamel kettles, ceramic drippers and table linen, delivered across Riyadh and the Eastern Province.", "غلايات مينا ومقطّرات سيراميك وأقمشة مائدة، نوصّل في الرياض والمنطقة الشرقية."),
  },
};

// Light, low-contrast brand colours on purpose: the backend's contrast derivation has to darken them for light grounds.
const theme = {
  brand: { primary: "#E9C46A", accent: "#2A9D8F", surface: "#FBF7F0", text: "#1F1A14", radiusScale: 1.5, typographyChoice: "contemporary" },
  theme: { defaultGround: "dark", darkEnabled: true, allowVisitorChoice: false, tokenOverrides: [] },
};

const fulfilment = {
  deliveryEnabled: true, pickupEnabled: false, defaultDispatchLeadDays: 2, cutoffTime: "14:00", maxDaysAhead: 30,
  orderMinimum: "150.00", shippingFeeMode: "FLAT", flatShippingFee: "30.00", allowGuestCheckout: false,
  tax: { mode: "INCLUDED", rate: 15 }, customerCancelWindowMinutes: 10, returnWindowDays: 7,
};

const zones = [
  { name: L("Riyadh", "الرياض"), areas: ["Riyadh", "الرياض", "Diriyah", "الدرعية"], fee: "25.00", minimumOrder: "0.00", leadDays: 1, active: true, order: 0 },
  { name: L("Eastern Province", "المنطقة الشرقية"), areas: ["Dammam", "الدمام", "Khobar", "الخبر", "Dhahran", "الظهران"], fee: "45.00", minimumOrder: "300.00", leadDays: 3, active: true, order: 1 },
];
const pickups = [];

const range = (open, close) => [{ open, close }];
const hours = {
  // weekday 0 = Sunday ... 6 = Saturday; closed Friday morning, split shift otherwise
  weekly: [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, ranges: [{ open: "09:00", close: "13:00" }, { open: "16:00", close: "22:00" }] })).concat([{ weekday: 5, ranges: range("16:00", "22:00") }]),
  exceptions: [{ date: "2027-02-22", closed: true, ranges: [] }],
};

// No COD: both methods need a receipt, so every order starts AWAITING_PAYMENT.
const payments = {
  methods: [
    { method: "BANK_TRANSFER", enabled: true, order: 0, requiresProof: true, autoCancelMinutes: 2880, verificationWindowMinutes: 1440,
      destination: { accountName: "Qahwa & Co Trading", number: "SA0380000000608010167519" },
      instructions: L("Transfer the exact total to IBAN SA03 8000 0000 6080 1016 7519 (Qahwa & Co Trading), then upload the transfer receipt.", "حوّل المبلغ بالضبط إلى الآيبان SA03 8000 0000 6080 1016 7519 (قهوة وشركاه للتجارة) ثم ارفع إيصال التحويل.") },
    { method: "WALLET_TRANSFER", enabled: true, order: 1, requiresProof: true, autoCancelMinutes: 720, verificationWindowMinutes: 360,
      destination: { accountName: "Qahwa & Co", number: "0555550188" },
      instructions: L("Send the exact total to wallet 0555 550 188, then upload a screenshot of the confirmation.", "أرسل المبلغ بالضبط إلى المحفظة 0555 550 188 ثم ارفع لقطة شاشة للتأكيد.") },
  ],
};

const categories = [
  { slug: "brewing", name: L("Brewing", "التحضير"), image: "category-tools", description: L("Kettles, drippers and cezves for the morning cup.", "غلايات ومقطّرات وجِزَوات لفنجان الصباح.") },
  { slug: "cookware", name: L("Cookware", "أدوات الطهي"), description: L("Pans and pots that go from hob to table.", "مقالٍ وقدور تنتقل من الموقد إلى المائدة.") },
  { slug: "table", name: L("Table and linen", "المائدة والمفروشات"), image: "tote-canvas", description: L("Mugs, aprons and trays for setting the table.", "أكواب ومرايل وصواني لتجهيز المائدة.") },
];
const collections = [
  { slug: "morning-ritual", name: L("Morning ritual", "طقس الصباح"), image: "story-craft", description: L("Everything for a slow first cup.", "كل ما تحتاجه لفنجان أول بطيء.") },
];
const brands = [
  { slug: "qahwa-atelier", name: L("Qahwa Atelier", "مشغل قهوة"), description: L("Our own small-batch ceramics and enamelware.", "خزفنا ومطلياتنا بالمينا بكميات صغيرة.") },
];
const sizeGuides = [];

// Each purchasable product exercises a distinct state; see the slug annotations.
const products = [
  { // single axis with localized labels, no swatches; one low-stock variant; sale price
    slug: "enamel-kettle", name: L("Enamel gooseneck kettle", "غلاية مينا بعنق طويل"), category: "brewing", collections: ["morning-ritual"], brand: "qahwa-atelier",
    images: ["wrench-set"], axes: [axis("capacity", "Capacity", "السعة", [["600", "0.6 L", "٠٫٦ لتر"], ["1000", "1 L", "١ لتر"]])],
    description: L("A steel-core enamel kettle with a gooseneck spout for a thin, steady pour.", "غلاية بقلب فولاذي مطلية بالمينا وبصنبور طويل لصبّ رفيع ثابت."),
    specs: [spec("Material", "الخامة", "Enamelled steel", "فولاذ مطلي بالمينا"), spec("Hob", "الموقد", "Gas, electric, induction", "غاز وكهرباء وحث")],
    variants: mk("KTL", cross([["capacity", ["600", "1000"]]]), (c) => (c.capacity === "600" ? "285.00" : "335.00"), {
      compareAt: (c) => (c.capacity === "600" ? "340.00" : "395.00"), low: (c) => c.capacity === "1000",
    }),
    added: "2026-10-02",
  },
  { // no option axes, one variant, in stock
    slug: "ceramic-dripper", name: L("Ceramic pour-over dripper", "مقطّر سيراميك للقهوة المقطّرة"), category: "brewing", collections: ["morning-ritual"], brand: "qahwa-atelier",
    images: ["hand-plane"], axes: [],
    description: L("A ribbed stoneware dripper that sits on any mug or carafe.", "مقطّر من الخزف المضلّع يستقر على أي كوب أو إبريق."),
    specs: [spec("Size", "الحجم", "Fits 1 to 2 cups", "يكفي ١ إلى ٢ فنجان")],
    variants: single("DRP-ONE", "120.00"), added: "2026-09-18",
  },
  { // sold out entirely
    slug: "copper-cezve", name: L("Hammered copper cezve", "جِزوة نحاس مطروق"), category: "brewing", collections: ["morning-ritual"], images: ["chisel-set"], axes: [],
    description: L("A tin-lined copper cezve for coffee brewed the traditional way.", "جِزوة نحاسية مبطّنة بالقصدير لقهوة تُحضَّر بالطريقة التقليدية."),
    specs: [spec("Capacity", "السعة", "300 ml", "٣٠٠ مل")],
    variants: single("CZV-ONE", "210.00", OUT), added: "2026-08-24",
  },
  { // second single-axis product (diameter), no low stock, no sale price
    slug: "cast-iron-skillet", name: L("Pre-seasoned cast iron skillet", "مقلاة حديد زهر مُتبَّلة مسبقًا"), category: "cookware", collections: [], brand: "qahwa-atelier",
    images: ["tool-roll"], axes: [axis("diameter", "Diameter", "القطر", [["20", "20 cm", "٢٠ سم"], ["26", "26 cm", "٢٦ سم"]])],
    description: L("A heavy skillet that holds its heat and improves with every meal.", "مقلاة ثقيلة تحتفظ بحرارتها وتتحسن مع كل وجبة."),
    specs: [spec("Material", "الخامة", "Cast iron", "حديد زهر")],
    variants: mk("SKT", cross([["diameter", ["20", "26"]]]), (c) => (c.diameter === "20" ? "245.00" : "380.00")), added: "2026-09-05",
  },
  { // NO images at all
    slug: "stoneware-mug-set", name: L("Stoneware mug set of four", "طقم أكواب خزف من أربعة"), category: "table", collections: ["morning-ritual"], images: [], axes: [],
    description: L("Four hand-glazed stoneware mugs in a speckled oatmeal glaze.", "أربعة أكواب خزف مطلية يدويًا بطلاء بلون الشوفان المنقّط."),
    specs: [spec("Capacity (each)", "السعة (للواحد)", "280 ml", "٢٨٠ مل")],
    variants: single("MUG-4", "180.00"), added: "2026-09-26",
  },
  {
    slug: "linen-apron", name: L("Washed linen apron", "مريلة كتان مغسول"), category: "table", collections: [], brand: "qahwa-atelier", images: ["apron-leather"], axes: [],
    description: L("A cross-back apron in washed linen with two deep pockets.", "مريلة بأحزمة متقاطعة من الكتان المغسول بجيبين عميقين."),
    specs: [spec("Fabric", "الخامة", "100% linen", "١٠٠٪ كتان")],
    variants: single("APN-ONE", "95.00"), added: "2026-10-09",
  },
  { // priced exactly at the order minimum (150.00)
    slug: "serving-tray", name: L("Walnut serving tray", "صينية تقديم من الجوز"), category: "table", collections: [], images: ["tote-canvas"], axes: [],
    description: L("A solid walnut tray with routed handles.", "صينية من خشب الجوز الصلب بمقبضين محفورين."),
    specs: [spec("Size", "الحجم", "45 x 30 cm", "٤٥ × ٣٠ سم")],
    variants: single("TRY-ONE", "150.00"), added: "2026-07-21",
  },
].sort((a, b) => a.added.localeCompare(b.added));

const pages = [
  { slug: "terms", title: L("Terms of Sale", "شروط البيع"), content: L(
    "Orders at Qahwa & Co are paid by bank or wallet transfer.\n\n1. All prices are in Saudi riyals and include 15% VAT.\n2. Your order is held until we receive your transfer receipt, and is released automatically if none arrives in time.\n3. You need an account to check out so we can track your order.",
    "تُدفع طلبات قهوة وشركاه بالتحويل البنكي أو عبر المحفظة.\n\n١. جميع الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة ١٥٪.\n٢. يُحجز طلبك حتى نستلم إيصال التحويل، ويُفرج عنه تلقائيًا إن لم يصل في الوقت المحدد.\n٣. تحتاج إلى حساب لإتمام الطلب حتى نتمكن من متابعته.") },
  { slug: "privacy", title: L("Privacy Policy", "سياسة الخصوصية"), content: L(
    "We keep your name, mobile number, delivery address and order history to fulfil your orders. Transfer receipts are visible only to our payments team. Write to salam@qahwa-co.example to export or erase your data.",
    "نحتفظ باسمك ورقم جوالك وعنوان التوصيل وسجل طلباتك لتنفيذ طلباتك. إيصالات التحويل لا يراها إلا فريق المدفوعات. راسلنا على salam@qahwa-co.example لتصدير بياناتك أو حذفها.") },
  { slug: "returns", title: L("Returns", "الإرجاع"), content: L(
    "Unused items in their original box can be returned within 7 days of delivery. Refunds are sent back to the account you paid from. Sale items and mug sets with a broken seal cannot be returned.",
    "يمكن إرجاع الأصناف غير المستخدمة في عبوتها الأصلية خلال ٧ أيام من التسليم. يُعاد المبلغ إلى الحساب الذي دفعت منه. لا تُقبل إعادة أصناف التخفيضات ولا أطقم الأكواب مكسورة الختم.") },
  { slug: "delivery", title: L("Delivery", "التوصيل"), content: L(
    "We deliver to Riyadh in 1 day and to the Eastern Province in 3 days after your transfer is confirmed. Delivery is a flat 30 SAR; we do not offer pickup.",
    "نوصّل إلى الرياض خلال يوم واحد وإلى المنطقة الشرقية خلال ٣ أيام بعد تأكيد التحويل. التوصيل برسم ثابت ٣٠ ريالًا، ولا نوفّر الاستلام من المتجر.") },
];

// One automatic promotion, different in kind from store A's: a percentage off above a subtotal. No coded promotion.
const promotions = [
  {
    name: L("12% off baskets over 400 SAR", "خصم ١٢٪ على السلال فوق ٤٠٠ ريال"), description: L("12% off the whole basket when it reaches 400 SAR.", "خصم ١٢٪ على السلة كاملة عند بلوغها ٤٠٠ ريال."),
    type: "PERCENT", value: "12", conditions: { minSubtotal: "400.00" }, stackable: false, active: true,
  },
];

const t = (kind, slug) => ({ kind, slug });
const content = {
  announcements: [{ message: L("Sign in to check out. Transfers only: no cash on delivery.", "سجّل الدخول لإتمام الطلب. التحويل فقط: لا دفع عند الاستلام."), enabled: true }],
  headerNavigation: [
    { target: t("category", "brewing"), label: L("Brewing", "التحضير") },
    { target: t("category", "cookware"), label: L("Cookware", "أدوات الطهي") },
    { target: t("category", "table"), label: L("Table", "المائدة") },
    { target: t("collection", "morning-ritual"), label: L("Morning ritual", "طقس الصباح") },
  ],
  footerNavigation: [
    { target: t("page", "delivery"), label: L("Delivery", "التوصيل") },
    { target: t("page", "returns"), label: L("Returns", "الإرجاع") },
  ],
  homeSections: [
    { type: "campaignHero", headline: L("Slow mornings, well equipped", "صباحات هادئة بأدوات متقنة"), subline: L("Kettles, drippers and cezves for the first cup.", "غلايات ومقطّرات وجِزَوات لأول فنجان."), actionLabel: L("Shop the ritual", "تسوّق الطقس"), target: t("collection", "morning-ritual") },
    { type: "productRail", source: "collection", collection: "morning-ritual", heading: L("The morning ritual", "طقس الصباح") },
    { type: "categoryTiles", heading: L("Browse", "تصفّح"), categories: ["brewing", "cookware", "table"] },
    { type: "assuranceStrip" },
  ],
};

export default {
  key: "store-b",
  store, theme, fulfilment, zones, pickups, hours, payments,
  brands, categories, collections, sizeGuides,
  products, pages, promotions, content,
};
