// Store A: "Hirfa", the original demo merchant. A Cairo workshop selling washed-linen clothing and forged hand tools.
// Broad on purpose: EGP, light brand, COD + two proof-based wallets, delivery AND pickup, three zones, guest checkout,
// a size guide, multi-axis products with swatches, a coded promotion and an automatic one.
// Plain data only. Images are file names (without .jpg) in the shared preview image directory, resolved by the seeder.
import { L, OK, OUT, LOW, axis, plainAxis, cross, mk, single, spec } from "./_builders.mjs";

const store = {
  name: L("Hirfa", "حِرفة"),
  tagline: L("Clothes and tools, made to be used for years", "ملابس وعُدد تُصنع لتُستخدم سنوات"),
  description: L(
    "Hirfa is a Cairo workshop making washed-linen clothing and forged hand tools designed to be repaired, resoled and handed down.",
    "حِرفة ورشة في القاهرة تصنع ملابس من الكتان المغسول وعُددًا يدوية مطروقة، مصممة لتُصلَح وتُورَّث."
  ),
  heroMedia: "hero-workshop",
  ogImage: "editorial-band",
  contact: { phone: "+20 100 555 0142", email: "hello@hirfa.example", whatsApp: "+201005550142" },
  socialLinks: [
    { platform: "instagram", url: "https://instagram.com/hirfa.workshop" },
    { platform: "facebook", url: "https://facebook.com/hirfa.workshop" },
    { platform: "tiktok", url: "https://tiktok.com/@hirfa.workshop" },
  ],
  currency: "EGP",
  defaultLocale: "ar",
  supportedLocales: ["ar", "en"],
  defaultSeo: {
    title: L("Hirfa | Clothes and tools made to last", "حِرفة | ملابس وعُدد تدوم"),
    description: L("Washed linen shirts, workwear and forged hand tools from a Cairo workshop. Delivery across Egypt.", "قمصان كتان مغسول وملابس عمل وعُدد يدوية مطروقة من ورشة في القاهرة. توصيل لكل مصر."),
  },
};
const theme = {
  brand: { primary: "#9F4E19", accent: "#4B5B43", surface: "#F7F5F1", text: "#1B1A17", radiusScale: 1, typographyChoice: "default" },
  theme: { defaultGround: "light", darkEnabled: true, allowVisitorChoice: true, tokenOverrides: [] },
};
const fulfilment = {
  deliveryEnabled: true, pickupEnabled: true, defaultDispatchLeadDays: 1, cutoffTime: "16:00", maxDaysAhead: 14,
  orderMinimum: "0.00", shippingFeeMode: "BY_ZONE", allowGuestCheckout: true,
  tax: { mode: "ADDED", rate: 0 }, customerCancelWindowMinutes: 30, returnWindowDays: 14,
};
const zones = [
  { name: L("Greater Cairo", "القاهرة الكبرى"), areas: ["Cairo", "القاهرة", "Giza", "الجيزة", "Qalyubia", "القليوبية"], fee: "75.00", minimumOrder: "0.00", leadDays: 2, active: true, order: 0 },
  { name: L("Alexandria and the Delta", "الإسكندرية والدلتا"), areas: ["Alexandria", "الإسكندرية", "Dakahlia", "الدقهلية"], fee: "95.00", minimumOrder: "500.00", leadDays: 3, active: true, order: 1 },
  { name: L("Red Sea", "البحر الأحمر"), areas: ["Red Sea", "البحر الأحمر"], fee: "150.00", minimumOrder: "1500.00", leadDays: 4, active: true, order: 2 },
];
const pickups = [
  { name: L("Hirfa workshop, Zamalek", "ورشة حِرفة، الزمالك"), address: L("14 Mohamed Mazhar St, Zamalek, Cairo", "١٤ شارع محمد مظهر، الزمالك، القاهرة"), coordinates: { lat: 30.0626, lng: 31.2197 }, phone: "+20 100 555 0142", active: true, order: 0 },
  { name: L("Hirfa pickup point, Maadi", "نقطة استلام حِرفة، المعادي"), address: L("9 Road 233, Degla, Maadi, Cairo", "٩ شارع ٢٣٣، دجلة، المعادي، القاهرة"), coordinates: { lat: 29.9602, lng: 31.2569 }, phone: "+20 100 555 0143", active: true, order: 1 },
];
const range = (open, close) => [{ open, close }];
const hours = {
  // weekday 0 = Sunday ... 6 = Saturday; Friday opens late
  weekly: [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, ranges: range("10:00", "20:00") })).concat([{ weekday: 5, ranges: range("14:00", "20:00") }]),
  exceptions: [{ date: "2027-01-07", closed: true, ranges: [] }],
};
const payments = {
  methods: [
    { method: "COD", enabled: true, order: 0, requiresProof: false, instructions: L("Pay the courier in cash when your order arrives.", "ادفع نقدًا لمندوب التوصيل عند وصول طلبك.") },
    { method: "WALLET", enabled: true, order: 1, requiresProof: true, autoCancelMinutes: 1440, verificationWindowMinutes: 720,
      destination: { accountName: "Hirfa", number: "01005550142" },
      instructions: L("Transfer the exact total to 0100 555 0142, then upload the receipt.", "حوّل المبلغ بالضبط إلى 0100 555 0142 ثم ارفع إيصال التحويل.") },
    { method: "INSTAPAY", enabled: true, order: 2, requiresProof: true, autoCancelMinutes: 1440, verificationWindowMinutes: 720,
      destination: { accountName: "Hirfa", handle: "hirfa@instapay" },
      instructions: L("Send the exact total to hirfa@instapay, then upload the receipt.", "أرسل المبلغ بالضبط إلى hirfa@instapay ثم ارفع إيصال التحويل.") },
  ],
};

const categoriesData = [
  { slug: "shirts", name: L("Shirts", "قمصان"), image: "category-apparel", description: L("Washed linen shirts cut to move.", "قمصان كتان مغسول مفصّلة للحركة.") },
  { slug: "hand-tools", name: L("Hand tools", "عُدد يدوية"), image: "category-tools", description: L("Forged and honed tools for the bench.", "عُدد مطروقة ومشحوذة لطاولة العمل.") },
  { slug: "workwear", name: L("Workwear", "ملابس العمل"), image: "category-workwear", description: L("Jackets, aprons and boots built for the workshop.", "جاكيتات ومرايل وأحذية مصنوعة للورشة.") },
  { slug: "accessories", name: L("Accessories", "إكسسوارات"), image: "tote-canvas", description: L("Bags and small carry goods.", "حقائب ومستلزمات حمل صغيرة.") },
  { slug: "knitwear", name: L("Knitwear", "تريكو"), parent: "workwear", description: L("Layers that sit under a jacket.", "طبقات تُلبس تحت الجاكيت.") },
  { slug: "trousers", name: L("Trousers", "بناطيل"), parent: "workwear", description: L("Hard-wearing trousers for long days.", "بناطيل متينة لأيام العمل الطويلة.") },
  { slug: "workshop", name: L("Workshop", "مستلزمات الورشة"), description: L("Measuring, fastening and carrying for the workshop.", "قياس وربط وحمل لمستلزمات الورشة.") },
];
const collectionsData = [
  { slug: "washed-linen", name: L("Washed linen", "الكتان المغسول"), image: "story-wardrobe", description: L("Shirts cut from heavy linen, washed until soft — they only get better.", "قمصان من كتان ثقيل مغسول حتى يلين، ويزداد جمالًا مع الوقت.") },
  { slug: "the-workbench", name: L("The workbench", "طاولة العمل"), image: "story-craft", description: L("Forged edges and honest steel. Tools you hand down.", "حواف مطروقة وصلب صادق. عُدد تُورَّث.") },
  { slug: "autumn-work", name: L("Autumn work clothes", "ملابس العمل للخريف"), image: "editorial-band", description: L("Canvas, wool and leather for cool mornings in the workshop.", "كانفاس وصوف وجلد لصباحات الورشة الباردة.") },
];
const brandsData = [
  { slug: "hirfa", name: L("Hirfa", "حِرفة"), description: L("Our own clothing line, made in the Cairo workshop.", "خط ملابسنا الخاص، يُصنع في ورشة القاهرة.") },
  { slug: "nile-forge", name: L("Nile Forge", "نيل فورج"), description: L("Forged hand tools from a family smithy in Helwan.", "عُدد يدوية مطروقة من ورشة حدادة عائلية في حلوان.") },
];
const sizeGuidesData = [
  {
    name: L("Shirt size guide", "دليل مقاسات القمصان"),
    description: L("Garment measurements in centimetres, laid flat.", "قياسات القطعة بالسنتيمتر وهي مسطّحة."),
    chartData: { headers: ["Size", "Chest (cm)", "Length (cm)", "Sleeve (cm)"], rows: [["S", "104", "74", "62"], ["M", "108", "76", "63"], ["L", "114", "78", "64"], ["XL", "120", "80", "65"], ["XXL", "126", "82", "66"]] },
  },
  {
    name: L("Trouser size guide", "دليل مقاسات البناطيل"),
    description: L("Waist and inseam in inches.", "الخصر والطول الداخلي بالبوصة."),
    chartData: { headers: ["Waist (in)", "Waist (cm)", "Hip (cm)"], rows: [["30", "76", "98"], ["32", "81", "103"], ["34", "86", "108"], ["36", "91", "113"]] },
  },
];


const products = [
  {
    slug: "washed-linen-shirt", name: L("Washed linen camp shirt", "قميص كتان مغسول بياقة مفتوحة"), category: "shirts", collections: ["washed-linen"], brand: "hirfa", sizeGuide: 0, images: ["shirt-linen-olive", "shirt-linen-olive-2"], axes: [axis("colour", "Colour", "اللون", [["olive", "Olive", "زيتوني", "#5F6B4A"], ["sand", "Sand", "رملي", "#D8C7A6"], ["ink", "Ink", "كحلي داكن", "#22262E"]]), plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL", "XXL"])],
    description: L("Cut from 190 g/m² European linen and garment-washed for a soft, lived-in hand from the first wear. A camp collar, a single chest pocket and corozo buttons. Relaxed through the body; size down for a closer fit.", "مفصّل من كتان أوروبي بوزن ١٩٠ جم/م² ومغسول بعد الخياطة ليكون ناعمًا من أول ارتداء. ياقة مفتوحة وجيب واحد على الصدر وأزرار من الكوروزو. قصّة مريحة؛ اختر مقاسًا أصغر لقَصّة أقرب."),
    specs: [spec("Fabric", "الخامة", "100% linen, 190 g/m²", "١٠٠٪ كتان، ١٩٠ جم/م²"), spec("Fit", "القصّة", "Relaxed", "مريحة"), spec("Length (M)", "الطول (M)", "76 cm", "٧٦ سم"), spec("Care", "العناية", "Machine wash 40°C, line dry", "غسيل آلي ٤٠° وتجفيف طبيعي")],
    variants: mk("LSH", cross([["colour", ["olive", "sand", "ink"]], ["size", ["S", "M", "L", "XL", "XXL"]]]), "1450.00", {
      notMade: (c) => c.colour === "ink" && c.size === "XXL", soldOut: (c) => c.colour === "sand" && c.size === "M", low: (c) => c.colour === "olive" && c.size === "L",
      gallery: (c) => (c.colour === "olive" ? ["shirt-linen-olive", "shirt-linen-olive-2"] : c.colour === "sand" ? ["shirt-linen-sand"] : null),
    }),
    added: "2026-09-28",
  },
  {
    slug: "camp-collar-linen-shirt", name: L("Long-sleeve linen work shirt", "قميص عمل من الكتان بأكمام طويلة"), category: "shirts", collections: ["washed-linen"], brand: "hirfa", sizeGuide: 0, images: ["shirt-linen-sand"], axes: [plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL"])],
    description: L("A long-sleeved work shirt in the same washed linen, with a box-pleated back for reaching.", "قميص عمل بأكمام طويلة من نفس الكتان المغسول، بطية في الظهر لحرية الحركة."),
    specs: [spec("Fabric", "الخامة", "100% linen", "١٠٠٪ كتان"), spec("Fit", "القصّة", "Regular", "عادية")],
    variants: mk("CCS", cross([["size", ["S", "M", "L", "XL"]]]), "1250.00", { compareAt: "1490.00" }), added: "2026-10-04",
  },
  {
    slug: "canvas-chore-jacket", name: L("Brushed wool work jacket", "جاكيت عمل من الصوف المُمشَّط"), category: "workwear", collections: ["autumn-work"], brand: "hirfa", images: ["overshirt-chore"], axes: [plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL"])],
    description: L("Dense brushed wool with a lined body and deep patch pockets — warm enough for cold workshop mornings.", "صوف كثيف مُمشَّط ببطانة داخلية وجيوب عميقة، دافئ بما يكفي لصباحات الورشة الباردة."),
    specs: [spec("Fabric", "الخامة", "80% wool, 20% nylon", "٨٠٪ صوف، ٢٠٪ نايلون"), spec("Pockets", "الجيوب", "4", "٤")],
    variants: mk("CJK", cross([["size", ["S", "M", "L", "XL"]]]), "2850.00", { compareAt: "3400.00", soldOut: (c) => c.size === "S" }), added: "2026-09-12",
  },
  {
    slug: "merino-crew-knit", name: L("Merino crew knit", "كنزة صوف ميرينو"), category: "knitwear", collections: ["autumn-work"], brand: "hirfa", sizeGuide: 0, images: ["knit-sweater"], axes: [plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL"])],
    description: L("A fine-gauge merino crew that layers under a jacket without bulk.", "كنزة من صوف الميرينو الناعم تُلبس تحت الجاكيت دون ثقل."),
    specs: [spec("Fabric", "الخامة", "100% merino wool", "١٠٠٪ صوف ميرينو")],
    variants: mk("MCK", cross([["size", ["S", "M", "L", "XL"]]]), "1950.00"), added: "2026-10-08",
  },
  {
    slug: "work-trousers", name: L("Twill work trousers", "بنطلون عمل من التويل"), category: "trousers", collections: ["autumn-work"], brand: "hirfa", sizeGuide: 1, images: ["trousers-chino"], axes: [plainAxis("waist", "Waist", "الخصر", ["30", "32", "34", "36"]), plainAxis("length", "Length", "الطول", ["30", "32", "34"])],
    description: L("Mid-weight cotton twill with a gusseted crotch and a reinforced hem.", "تويل قطني متوسط الوزن بتقوية في الحِجر والأطراف."),
    specs: [spec("Fabric", "الخامة", "10 oz cotton twill", "تويل قطني ١٠ أونصة"), spec("Rise", "ارتفاع الخصر", "Mid", "متوسط")],
    variants: mk("TWT", cross([["waist", ["30", "32", "34", "36"]], ["length", ["30", "32", "34"]]]), "1650.00", { notMade: (c) => c.waist === "30" && c.length === "34", soldOut: (c) => c.waist === "32" && c.length === "32" }), added: "2026-08-30",
  },
  {
    slug: "leather-work-apron", name: L("Leather work apron", "مريلة عمل من الجلد"), category: "workwear", collections: ["the-workbench", "autumn-work"], brand: "hirfa", images: ["apron-leather", "category-workwear"], axes: [],
    description: L("Vegetable-tanned leather bib apron with cross-back straps that take the weight off your neck.", "مريلة من الجلد المدبوغ نباتيًا بأحزمة متقاطعة على الظهر تريح الرقبة."),
    specs: [spec("Leather", "الجلد", "2 mm vegetable-tanned", "مدبوغ نباتيًا ٢ مم"), spec("Length", "الطول", "86 cm", "٨٦ سم")],
    variants: single("APR-ONE", "1650.00", LOW), added: "2026-09-20", // axis-less, single low-stock variant
  },
  {
    slug: "canvas-tote", name: L("Coated canvas tote", "حقيبة من الكانفاس المغطّى"), category: "accessories", collections: [], brand: "hirfa", images: ["tote-canvas"], axes: [],
    description: L("A deep, structured tote in coated canvas that stands on its own.", "حقيبة عميقة متماسكة من كانفاس مغطّى تقف بمفردها."),
    specs: [spec("Capacity", "السعة", "22 L", "٢٢ لترًا")], variants: single("TOT-ONE", "690.00"), added: "2026-07-14",
  },
  {
    slug: "leather-work-boots", name: L("Leather work boots", "حذاء عمل من الجلد"), category: "workwear", collections: ["autumn-work"], brand: "hirfa", images: ["boots-leather"], axes: [plainAxis("size", "Size", "المقاس", ["40", "41", "42", "43", "44", "45"])],
    description: L("Goodyear-welted full-grain leather boots on a resoleable sole.", "حذاء من الجلد الطبيعي بخياطة جوديير ونعل قابل للتغيير."),
    specs: [spec("Construction", "طريقة الصنع", "Goodyear welt", "خياطة جوديير"), spec("Upper", "الوجه", "Full-grain leather", "جلد طبيعي كامل")],
    variants: mk("BTS", cross([["size", ["40", "41", "42", "43", "44", "45"]]]), "3900.00", { soldOut: (c) => c.size === "45", low: (c) => c.size === "44" }), added: "2026-09-02",
  },
  {
    slug: "bench-chisel-set", name: L("Bench chisel set", "طقم أزاميل نجارة"), category: "hand-tools", collections: ["the-workbench"], brand: "nile-forge", images: ["chisel-set", "chisel-set-2"], axes: [axis("set", "Set", "الطقم", [["3", "3 chisels", "٣ أزاميل"], ["5", "5 chisels", "٥ أزاميل"]])],
    description: L("Drop-forged chrome-vanadium blades hardened to 60 HRC, ground flat on the back and honed ready to use, in two-part grips with a strike cap for mallet work.", "شفرات من صلب الكروم فاناديوم مطروقة ومقساة إلى ٦٠ HRC، مسطّحة الظهر ومشحوذة وجاهزة للاستخدام، بمقابض من جزأين وغطاء للطَّرق بالمطرقة الخشبية."),
    specs: [spec("Blade widths (set of 3)", "عرض الشفرات (طقم ٣)", "6 · 12 · 20 mm", "٦ · ١٢ · ٢٠ مم"), spec("Steel", "الصلب", "Chrome-vanadium, 60 HRC", "كروم فاناديوم، ٦٠ HRC"), spec("Bevel", "زاوية الشطف", "25°", "٢٥°"), spec("Handle", "المقبض", "Two-part grip, strike cap", "مقبض من جزأين بغطاء للطَّرق")],
    variants: mk("CHS", cross([["set", ["3", "5"]]]), (c) => (c.set === "3" ? "1850.00" : "2950.00")), added: "2026-10-01",
  },
  {
    slug: "low-angle-block-plane", name: L("Low-angle block plane", "فارة كتلة بزاوية منخفضة"), category: "hand-tools", collections: ["the-workbench"], brand: "nile-forge", images: ["hand-plane"], axes: [],
    description: L("Ductile iron body, 12° bed and an adjustable mouth for end grain.", "جسم من الحديد المرن بزاوية ١٢° وفتحة قابلة للضبط لأطراف الألياف."),
    specs: [spec("Bed angle", "زاوية القاعدة", "12°", "١٢°"), spec("Blade width", "عرض الشفرة", "35 mm", "٣٥ مم"), spec("Length", "الطول", "160 mm", "١٦٠ مم")],
    variants: single("BPL-12", "1850.00"), added: "2026-09-25",
  },
  {
    slug: "claw-hammer", name: L("Hickory claw hammer", "مطرقة بمخلب ومقبض من الهيكوري"), category: "hand-tools", collections: ["the-workbench"], brand: "nile-forge", images: ["hammer-claw"], axes: [axis("weight", "Head weight", "وزن الرأس", [["450", "450 g", "٤٥٠ جم"], ["570", "570 g", "٥٧٠ جم"]])],
    description: L("A forged head on a hickory handle, balanced for long days of framing.", "رأس مطروق على مقبض من خشب الهيكوري، متوازن لأيام العمل الطويلة."),
    specs: [spec("Handle", "المقبض", "Hickory, 330 mm", "هيكوري، ٣٣٠ مم")],
    variants: mk("HMR", cross([["weight", ["450", "570"]]]), (c) => (c.weight === "450" ? "640.00" : "720.00")), added: "2026-08-18",
  },
  {
    slug: "rip-saw", name: L("Western rip saw", "منشار شقّ غربي"), category: "hand-tools", collections: ["the-workbench"], brand: "nile-forge", images: ["hand-saw"], axes: [],
    description: L("Taper-ground plate filed rip at 7 points per inch.", "نصل مستدق مسنون للشقّ بمعدل ٧ أسنان في البوصة."),
    specs: [spec("Plate", "النصل", "560 mm, 7 PPI", "٥٦٠ مم، ٧ أسنان/بوصة")], variants: single("SAW-7PPI", "980.00"), added: "2026-07-30",
  },
  {
    slug: "adjustable-wrench", name: L("Forged adjustable wrench", "مفتاح ربط قابل للضبط مطروق"), category: "workshop", collections: [], brand: "nile-forge", images: ["wrench-set"], axes: [axis("length", "Length", "الطول", [["200", "200 mm", "٢٠٠ مم"], ["300", "300 mm", "٣٠٠ مم"]])],
    description: L("Drop-forged chrome-vanadium with a fine worm screw that holds its setting.", "صلب كروم فاناديوم مطروق ببرغي دقيق يحفظ ضبطه."),
    specs: [spec("Jaw capacity (200 mm)", "فتحة الفك (٢٠٠ مم)", "27 mm", "٢٧ مم")],
    variants: mk("WRN", cross([["length", ["200", "300"]]]), (c) => (c.length === "200" ? "450.00" : "620.00"), { soldOut: (c) => c.length === "300" }), added: "2026-06-11",
  },
  {
    slug: "leather-tool-pouch", name: L("Leather tool pouch", "حقيبة عُدد جلدية للحزام"), category: "workshop", collections: ["the-workbench"], brand: "hirfa", images: ["tool-roll"], axes: [],
    description: L("A belt pouch in vegetable-tanned leather with six pockets and a hammer loop.", "حقيبة حزام من الجلد المدبوغ نباتيًا بستة جيوب وحلقة للمطرقة."),
    specs: [spec("Pockets", "الجيوب", "6 + hammer loop", "٦ + حلقة للمطرقة")], variants: single("PCH-6", "1190.00"), added: "2026-09-08",
  },
  {
    slug: "tape-measure", name: L("Five-metre tape measure", "شريط قياس بطول ٥ أمتار"), category: "workshop", collections: ["the-workbench"], brand: "nile-forge", images: ["folding-rule"], axes: [],
    description: L("A 25 mm blade with millimetre graduations and a true-zero hook.", "شريط بعرض ٢٥ مم بتدريج بالمليمتر وخطاف بصفر دقيق."),
    specs: [spec("Length", "الطول", "5 m", "٥ م"), spec("Blade", "الشريط", "25 mm", "٢٥ مم")], variants: single("TAP-5M", "260.00"), added: "2026-10-06",
  },
  {
    slug: "forest-hatchet", name: L("Forest hatchet", "بلطة صغيرة للغابات"), category: "hand-tools", collections: [], brand: "nile-forge", images: ["axe"], axes: [],
    description: L("A hand-forged head on a 35 cm hickory haft, with a leather edge guard.", "رأس مطروق يدويًا على يد من الهيكوري بطول ٣٥ سم مع غطاء جلدي للحد."),
    specs: [spec("Head", "الرأس", "600 g, hand-forged", "٦٠٠ جم، مطروق يدويًا")], variants: single("HTC-35", "1390.00", OUT), added: "2026-05-20", // sold out entirely
  },
].sort((a, b) => a.added.localeCompare(b.added)); // create oldest first so "newest" ordering by createdAt matches the fixture

const pagesData = [
  { slug: "terms", title: L("Terms of Sale", "شروط البيع"), content: L(
    "These terms govern every order placed on Hirfa.\n\n1. Prices are in Egyptian pounds and include no delivery fee unless shown at checkout.\n2. An order is confirmed once payment is received or, for cash on delivery, once we confirm it by phone.\n3. We may cancel an order if an item cannot be supplied; you will be refunded in full.\n4. Goods remain ours until paid for.",
    "تنظّم هذه الشروط كل طلب يتم عبر حِرفة.\n\n١. الأسعار بالجنيه المصري ولا تشمل رسوم التوصيل ما لم تظهر عند إتمام الطلب.\n٢. يتأكد الطلب عند استلام الدفع، أو عند تأكيدنا له هاتفيًا في حالة الدفع عند الاستلام.\n٣. يحق لنا إلغاء الطلب إذا تعذّر توفير أحد الأصناف، وسيُردّ إليك المبلغ كاملًا.\n٤. تبقى البضاعة ملكًا لنا حتى يتم سدادها.") },
  { slug: "privacy", title: L("Privacy Policy", "سياسة الخصوصية"), content: L(
    "We collect only what we need to deliver your order: your name, phone number, address and email. We never sell your data. You can ask us to delete your account at any time by writing to hello@hirfa.example.",
    "نجمع فقط ما نحتاجه لتوصيل طلبك: الاسم ورقم الهاتف والعنوان والبريد الإلكتروني. لا نبيع بياناتك أبدًا. يمكنك طلب حذف حسابك في أي وقت بمراسلتنا على hello@hirfa.example.") },
  { slug: "returns", title: L("Returns & Refunds", "الإرجاع والاسترداد"), content: L(
    "You can return unused items within 14 days of delivery. Clothing must be unwashed with tags attached; tools must be unused. Refunds go back to the original payment method within 7 working days of us receiving the item. Items made to order are not returnable.",
    "يمكنك إرجاع الأصناف غير المستخدمة خلال ١٤ يومًا من التسليم. يجب أن تكون الملابس غير مغسولة وعليها البطاقات، والعُدد غير مستخدمة. يُردّ المبلغ بنفس وسيلة الدفع خلال ٧ أيام عمل من استلامنا القطعة. الأصناف المصنوعة حسب الطلب غير قابلة للإرجاع.") },
  { slug: "shipping", title: L("Delivery & Collection", "التوصيل والاستلام"), content: L(
    "We deliver across Egypt in 2 to 4 working days depending on your governorate, with fees shown at checkout. You can also collect free from our Zamalek workshop or our Maadi pickup point during opening hours.",
    "نوصّل لكل محافظات مصر خلال ٢ إلى ٤ أيام عمل حسب المحافظة، وتظهر الرسوم عند إتمام الطلب. ويمكنك أيضًا الاستلام مجانًا من ورشتنا في الزمالك أو من نقطة المعادي خلال ساعات العمل.") },
  { slug: "contact", title: L("Contact", "اتصل بنا"), content: L(
    "Call or WhatsApp us on +20 100 555 0142, or write to hello@hirfa.example. We answer every day from 10:00 to 20:00 (Friday from 14:00).",
    "اتصل بنا أو راسلنا على واتساب على +20 100 555 0142، أو اكتب إلى hello@hirfa.example. نرد يوميًا من ١٠ صباحًا حتى ٨ مساءً (الجمعة من ٢ ظهرًا).") },
  { slug: "about", title: L("Our workshop", "عن ورشتنا"), content: L(
    "Hirfa began in a single room in Zamalek. We cut linen, forge steel with partner smiths and finish everything by hand, so that what you buy can be repaired rather than replaced.",
    "بدأت حِرفة في غرفة واحدة في الزمالك. نقصّ الكتان ونطرق الصلب مع حدّادين شركاء ونُنهي كل شيء يدويًا، لتُصلَح ما تشتريه بدلًا من أن يُستبدل.") },
  { slug: "care", title: L("Caring for linen and steel", "العناية بالكتان والصلب"), content: L(
    "Wash linen at 40°C and line dry; it softens with every wash. Keep steel dry, wipe it with a little camellia oil after use, and store it wrapped. Re-hone chisels and plane irons whenever they stop shaving cleanly.",
    "اغسل الكتان على ٤٠° وجفّفه على حبل؛ فهو يلين مع كل غسلة. أبقِ الصلب جافًا وامسحه بقليل من زيت الكاميليا بعد الاستخدام وخزّنه ملفوفًا. اشحذ الأزاميل وسكاكين الفارة كلما توقفت عن القشط النظيف.") },
];

const promotions = [
  {
    code: "WELCOME10", name: L("Welcome: 10% off", "ترحيب: خصم ١٠٪"), description: L("10% off your first order over 500 EGP.", "خصم ١٠٪ على أول طلب فوق ٥٠٠ جنيه."),
    type: "PERCENT", value: "10", conditions: { minSubtotal: "500.00", firstOrderOnly: true }, limits: { perCustomerUses: 1 }, stackable: false, active: true,
  },
  {
    name: L("Free delivery over 3,000 EGP", "توصيل مجاني فوق ٣٠٠٠ جنيه"), description: L("Delivery is on us for orders of 3,000 EGP or more.", "التوصيل علينا للطلبات بقيمة ٣٠٠٠ جنيه أو أكثر."),
    type: "FREE_SHIPPING", conditions: { minSubtotal: "3000.00" }, stackable: true, active: true,
  },
];

// Link targets are `{ kind, slug }`; the seeder resolves them to ids after the catalogue exists.
const t = (kind, slug) => ({ kind, slug });
const content = {
  announcements: [{ message: L("New: The workbench — hand tools made to be handed down", "جديد: طاولة العمل — عُدد يدوية تُصنع لتُورَّث"), target: t("collection", "the-workbench"), enabled: true }],
  headerNavigation: [
    { target: t("category", "shirts"), label: L("Shirts", "قمصان") },
    { target: t("category", "workwear"), label: L("Workwear", "ملابس العمل") },
    { target: t("category", "hand-tools"), label: L("Hand tools", "عُدد يدوية") },
    { target: t("category", "workshop"), label: L("Workshop", "مستلزمات الورشة") },
    { target: t("collection", "washed-linen"), label: L("Washed linen", "الكتان المغسول") },
    { target: t("collection", "the-workbench"), label: L("The workbench", "طاولة العمل") },
  ],
  footerNavigation: [
    { target: t("page", "about"), label: L("Our workshop", "عن ورشتنا") },
    { target: t("page", "care"), label: L("Caring for linen and steel", "العناية بالكتان والصلب") },
    { target: t("collection", "autumn-work"), label: L("Autumn work clothes", "ملابس العمل للخريف") },
  ],
  homeSections: [
    { type: "campaignHero", headline: L("Made to be used for years", "أشياء تُصنع لتُستخدم سنوات"), subline: L("Washed linen for the heat, forged steel for the bench.", "كتان مغسول لأيام الحر، وصلب مطروق لطاولة العمل."), actionLabel: L("Explore the workbench", "اكتشف طاولة العمل"), target: t("collection", "the-workbench") },
    { type: "categoryTiles", heading: L("Shop by category", "تسوق حسب الفئة"), categories: ["shirts", "hand-tools", "workwear", "accessories"] },
    { type: "collectionStory", collection: "washed-linen", heading: L("Washed linen", "الكتان المغسول") },
    { type: "productRail", source: "collection", collection: "the-workbench", heading: L("From the workbench", "من طاولة العمل") },
    { type: "editorialBand", collection: "the-workbench", headline: L("Every edge honed by hand before it leaves the workshop", "كل حدّ يُشحذ باليد قبل أن يغادر الورشة") },
    { type: "productRail", source: "newest" },
    { type: "assuranceStrip" },
  ],
};

export default {
  key: "store-a",
  store, theme, fulfilment, zones, pickups, hours, payments,
  brands: brandsData, categories: categoriesData, collections: collectionsData, sizeGuides: sizeGuidesData,
  products, pages: pagesData, promotions, content,
};
