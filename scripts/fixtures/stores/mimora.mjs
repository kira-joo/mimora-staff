// Store "mimora": a gift shop, filled with SAMPLE content so the owner can review the homepage redesign.
// Every text comes from the owner's approved homepage reference; what the reference does not say (prices of delivery,
// product copy, stock) is a placeholder and is stated as one. Seeds a LOCAL database only (see README, `--confirm-db`).
// Plain data only. Images are paths under the storefront's public/ folder (the owner's own files), resolved by the seeder.
import { L, single } from "./_builders.mjs";

const IMG = {
  logo: "brand/mimora/logo/mimora-logo.png",
  giftBoxes: "brand/mimora/categories/Gift-Boxes.jpeg",
  mugs: "brand/mimora/categories/mags.jpeg",
  pajamas: "brand/mimora/categories/pajamas.jpeg",
};

const store = {
  name: L("mimora", "ميمورا"),
  tagline: L("Thoughtful gifts for your favorite people.", "هدايا منتقاة بعناية لأحب الناس إلى قلبك."),
  description: L("Thoughtful gifts, delivered across Egypt.", "هدايا منتقاة بعناية، نوصّلها لكل أنحاء مصر."),
  logo: IMG.logo,
  heroMedia: IMG.giftBoxes,
  ogImage: IMG.giftBoxes,
  currency: "EGP",
  defaultLocale: "ar",
  supportedLocales: ["ar", "en"],
  defaultSeo: {
    title: L("mimora | Thoughtful gifts", "ميمورا | هدايا منتقاة بعناية"),
    description: L("Thoughtful gifts for your favorite people, delivered across Egypt.", "هدايا منتقاة بعناية لأحب الناس إلى قلبك، نوصّلها لكل أنحاء مصر."),
  },
};
// Primary and accent are the owner's rose. Surface and text are not in the reference as hex values: a warm blush ground and a
// deep rose-brown ink, read off the reference. The backend validates and derives the contrast-safe palette.
const theme = {
  brand: { primary: "#B35F6E", accent: "#E9A9B4", surface: "#FFF5F1", text: "#3D1F27", radiusScale: 1 },
  theme: { defaultGround: "light", darkEnabled: true, allowVisitorChoice: true, tokenOverrides: [] },
};
const fulfilment = {
  deliveryEnabled: true, pickupEnabled: false, defaultDispatchLeadDays: 1, cutoffTime: "16:00", maxDaysAhead: 14,
  orderMinimum: "0.00", shippingFeeMode: "BY_ZONE", allowGuestCheckout: true,
  tax: { mode: "ADDED", rate: 0 }, customerCancelWindowMinutes: 30, returnWindowDays: 14,
};
const zones = [
  // The fee is a placeholder ("a modest fee"); the owner sets the real one in Staff.
  { name: L("Cairo", "القاهرة"), areas: ["Cairo", "القاهرة"], fee: "60.00", minimumOrder: "0.00", leadDays: 2, active: true, order: 0 },
];
const payments = {
  methods: [
    { method: "COD", enabled: true, order: 0, requiresProof: false, instructions: L("Pay the courier in cash when your order arrives.", "ادفع نقدًا لمندوب التوصيل عند وصول طلبك.") },
  ],
};

const categories = [
  { slug: "gift-boxes", name: L("Gift Boxes", "بوكسات الهدايا"), image: IMG.giftBoxes, description: L("Ready to gift happiness", "سعادة جاهزة للإهداء") },
  { slug: "mugs-cups", name: L("Mugs & Cups", "مجات وأكواب"), image: IMG.mugs, description: L("Cute sips for brighter days", "رشفات لطيفة لأيام أكثر إشراقًا") },
  { slug: "pajamas", name: L("Pajamas", "بيجامات"), image: IMG.pajamas, description: L("Cozy days, happy girls", "أيام دافئة وبنات سعيدة") },
  { slug: "accessories", name: L("Accessories", "إكسسوارات"), image: IMG.giftBoxes, description: L("Little details, big smiles", "تفاصيل صغيرة، وابتسامات كبيرة") },
];

// The six occasion collections carry a one-line placeholder description each: the reference names the occasions only.
const collections = [
  { slug: "curated-gift-boxes", name: L("Curated Gift Boxes", "بوكسات هدايا مختارة"), image: IMG.giftBoxes, description: L("Ready-to-gift sets, made with love.", "مجموعات جاهزة للإهداء، صُنعت بحب.") },
  { slug: "birthdays", name: L("Birthdays", "أعياد الميلاد"), image: IMG.giftBoxes, description: L("Gifts for birthdays.", "هدايا لأعياد الميلاد.") },
  { slug: "special-occasions", name: L("Special Occasions", "المناسبات الخاصة"), image: IMG.pajamas, description: L("Gifts for special occasions.", "هدايا للمناسبات الخاصة.") },
  { slug: "just-because", name: L("Just Because", "بدون سبب"), image: IMG.mugs, description: L("Gifts, just because.", "هدايا بدون سبب.") },
  { slug: "for-her", name: L("For Her", "لها"), image: IMG.pajamas, description: L("Gifts for her.", "هدايا لها.") },
  { slug: "for-your-bestie", name: L("For Your Bestie", "لصديقتك المقرّبة"), image: IMG.mugs, description: L("Gifts for your bestie.", "هدايا لصديقتك المقرّبة.") },
  { slug: "for-yourself", name: L("For Yourself", "لنفسك"), image: IMG.giftBoxes, description: L("Gifts for yourself.", "هدايا لنفسك.") },
];

// Placeholder products: one variant each, stock 10 (a placeholder), no axes, no specs.
const sampleDescription = L("Sample gift box, replace in Staff.", "بوكس هدايا تجريبي، يُستبدل من لوحة الموظفين.");
const box = (slug, nameEn, nameAr, price, skuCode, images) => ({
  slug, name: L(nameEn, nameAr), category: "gift-boxes", collections: ["curated-gift-boxes"], images, axes: [],
  description: sampleDescription, specs: [], variants: single(skuCode, price, 10),
});
const products = [
  box("cozy-girl-gift-box", "Cozy Girl Gift Box", "بوكس كوزي جيرل", "890.00", "MIM-COZY", [IMG.giftBoxes, IMG.pajamas]),
  box("sweet-dreams-box", "Sweet Dreams Box", "بوكس أحلام سعيدة", "790.00", "MIM-DREAM", [IMG.pajamas, IMG.giftBoxes]),
  box("self-care-gift-box", "Self Care Gift Box", "بوكس العناية بالنفس", "990.00", "MIM-CARE", [IMG.giftBoxes, IMG.mugs]),
  box("mug-lover-box", "Mug Lover Box", "بوكس محبي المجات", "680.00", "MIM-MUG", [IMG.mugs, IMG.giftBoxes]),
];

const t = (kind, slug) => ({ kind, slug });
const content = {
  announcements: [{ message: L("Thoughtful gifts, delivered across Egypt ♡", "هدايا منتقاة بعناية، نوصّلها لكل أنحاء مصر ♡"), enabled: true }],
  // "Shop All" has no navigation target kind (category / collection / page only), so it is not seeded: reported as a gap.
  headerNavigation: [
    { target: t("category", "gift-boxes"), label: L("Gift Boxes", "بوكسات الهدايا") },
    { target: t("category", "mugs-cups"), label: L("Mugs & Cups", "مجات وأكواب") },
    { target: t("category", "pajamas"), label: L("Pajamas", "بيجامات") },
    { target: t("category", "accessories"), label: L("Accessories", "إكسسوارات") },
  ],
  footerNavigation: [],
  homeSections: [
    { type: "campaignHero", headline: L("Little things. Big feelings.", "أشياء صغيرة، مشاعر كبيرة."), subline: L("Thoughtful gifts for your favorite people.", "هدايا منتقاة بعناية لأحب الناس إلى قلبك."), actionLabel: L("Shop the collection", "تسوّق المجموعة"), target: t("collection", "curated-gift-boxes") },
    { type: "assuranceStrip" },
    { type: "categoryTiles", heading: L("Shop by Category", "تسوّق حسب الفئة"), categories: ["gift-boxes", "mugs-cups", "pajamas", "accessories"] },
    { type: "editorialBand", collection: "curated-gift-boxes", headline: L("Made for your favorite people", "صُنع لأحب الناس إلى قلبك") },
    // The reference also shows a sub-line under this heading; the rail section type carries a heading only.
    { type: "productRail", source: "collection", collection: "curated-gift-boxes", heading: L("Curated Gift Boxes", "بوكسات هدايا مختارة") },
  ],
};

export default {
  key: "mimora",
  store, theme, fulfilment, zones, pickups: [], payments,
  brands: [], categories, collections, sizeGuides: [],
  products, pages: [], promotions: [], content,
};
