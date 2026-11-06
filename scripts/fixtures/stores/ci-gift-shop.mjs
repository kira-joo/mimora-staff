// The CI fixture shop: "Sukkar & Qamar", an invented Cairo gift shop (a fixture merchant, not Mimora). Pajamas, gift boxes and
// mugs, priced in EGP. ONE identity and ONE catalogue, seeded under TWO settings profiles that exercise the capability states
// the owner can switch in the backoffice (so a storefront that only works for one of them fails here):
//   ci-default   light default ground, guest checkout, COD + two proof-based wallets, delivery AND pickup, per-zone fees, tax added
//                at 0%, no minimum order, seven pages, a seven-section home page, a coded and an automatic promotion.
//   ci-alternate dark default ground with no visitor choice, mandatory sign-in at checkout (the server refuses a guest order),
//                transfer-only payments that both need a receipt, an order minimum, a flat delivery fee, tax included at 14%
//                (Egypt's VAT), no pickup, two zones, four pages, a four-section home page in another order.
// Plain data only. Images are file names (without .jpg) in the fixture image directory, resolved by the seeder; they are
// downscaled copies and crops of the owner's own photos (see scripts/fixtures/README.md).
import { L, OUT, LOW, axis, plainAxis, cross, mk, single, spec } from "./_builders.mjs";

const store = {
  name: L("Sukkar & Qamar", "سُكّر وقمر"),
  tagline: L("Gifts wrapped with care, from pajamas to little treats", "هدايا مغلّفة بعناية، من البيجامات إلى الحلويات الصغيرة"),
  description: L(
    "Sukkar & Qamar is a Cairo gift studio putting together cosy pajamas, speckled mugs and ready-to-give boxes, wrapped by hand and delivered across Egypt.",
    "سُكّر وقمر استوديو هدايا في القاهرة يجمع بيجامات دافئة وأكوابًا مرقّطة وصناديق هدايا جاهزة، تُغلَّف يدويًا وتصل إلى كل مصر."
  ),
  heroMedia: "gift-box",
  ogImage: "pajamas-2",
  contact: { phone: "+20 100 555 0142", email: "hello@sukkar-qamar.example", whatsApp: "+201005550142" },
  socialLinks: [
    { platform: "instagram", url: "https://instagram.com/sukkarqamar.gifts" },
    { platform: "facebook", url: "https://facebook.com/sukkarqamar.gifts" },
    { platform: "tiktok", url: "https://tiktok.com/@sukkarqamar.gifts" },
  ],
  currency: "EGP",
  defaultLocale: "ar",
  supportedLocales: ["ar", "en"],
  defaultSeo: {
    title: L("Sukkar & Qamar | Gifts wrapped with care", "سُكّر وقمر | هدايا مغلّفة بعناية"),
    description: L("Pajamas, mugs and ready-to-give gift boxes from a Cairo studio. Delivery across Egypt.", "بيجامات وأكواب وصناديق هدايا جاهزة من استوديو في القاهرة. توصيل لكل مصر."),
  },
};
// ---------------------------------------------------------------------------------------------------------------- profile: ci-default
const defaultTheme = {
  brand: { primary: "#9F4E19", accent: "#4B5B43", surface: "#F7F5F1", text: "#1B1A17", radiusScale: 1 },
  theme: { defaultGround: "light", darkEnabled: true, allowVisitorChoice: true, tokenOverrides: [] },
};
const defaultFulfilment = {
  deliveryEnabled: true, pickupEnabled: true, defaultDispatchLeadDays: 1, cutoffTime: "16:00", maxDaysAhead: 14,
  orderMinimum: "0.00", shippingFeeMode: "BY_ZONE", allowGuestCheckout: true,
  tax: { mode: "ADDED", rate: 0 }, customerCancelWindowMinutes: 30, returnWindowDays: 14,
};
const defaultZones = [
  { name: L("Greater Cairo", "القاهرة الكبرى"), areas: ["Cairo", "القاهرة", "Giza", "الجيزة", "Qalyubia", "القليوبية"], fee: "75.00", minimumOrder: "0.00", leadDays: 2, active: true, order: 0 },
  { name: L("Alexandria and the Delta", "الإسكندرية والدلتا"), areas: ["Alexandria", "الإسكندرية", "Dakahlia", "الدقهلية"], fee: "95.00", minimumOrder: "500.00", leadDays: 3, active: true, order: 1 },
  { name: L("Red Sea", "البحر الأحمر"), areas: ["Red Sea", "البحر الأحمر"], fee: "150.00", minimumOrder: "1500.00", leadDays: 4, active: true, order: 2 },
];
const defaultPickups = [
  { name: L("Sukkar & Qamar studio, Zamalek", "استوديو سُكّر وقمر، الزمالك"), address: L("14 Mohamed Mazhar St, Zamalek, Cairo", "١٤ شارع محمد مظهر، الزمالك، القاهرة"), coordinates: { lat: 30.0626, lng: 31.2197 }, phone: "+20 100 555 0142", active: true, order: 0 },
  { name: L("Sukkar & Qamar pickup point, Maadi", "نقطة استلام سُكّر وقمر، المعادي"), address: L("9 Road 233, Degla, Maadi, Cairo", "٩ شارع ٢٣٣، دجلة، المعادي، القاهرة"), coordinates: { lat: 29.9602, lng: 31.2569 }, phone: "+20 100 555 0143", active: true, order: 1 },
];
const range = (open, close) => [{ open, close }];
const defaultHours = {
  // weekday 0 = Sunday ... 6 = Saturday; Friday opens late
  weekly: [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, ranges: range("10:00", "20:00") })).concat([{ weekday: 5, ranges: range("14:00", "20:00") }]),
  exceptions: [{ date: "2027-01-07", closed: true, ranges: [] }],
};
const defaultPayments = {
  methods: [
    { method: "COD", enabled: true, order: 0, requiresProof: false, instructions: L("Pay the courier in cash when your order arrives.", "ادفع نقدًا لمندوب التوصيل عند وصول طلبك.") },
    { method: "WALLET", enabled: true, order: 1, requiresProof: true, autoCancelMinutes: 1440, verificationWindowMinutes: 720,
      destination: { accountName: "Sukkar & Qamar", number: "01005550142" },
      instructions: L("Transfer the exact total to 0100 555 0142, then upload the receipt.", "حوّل المبلغ بالضبط إلى 0100 555 0142 ثم ارفع إيصال التحويل.") },
    { method: "INSTAPAY", enabled: true, order: 2, requiresProof: true, autoCancelMinutes: 1440, verificationWindowMinutes: 720,
      destination: { accountName: "Sukkar & Qamar", handle: "sukkarqamar@instapay" },
      instructions: L("Send the exact total to sukkarqamar@instapay, then upload the receipt.", "أرسل المبلغ بالضبط إلى sukkarqamar@instapay ثم ارفع إيصال التحويل.") },
  ],
};


// ---------------------------------------------------------------------------------------------------------------- shared catalogue
const categoriesData = [
  { slug: "pajamas", name: L("Pajamas", "بيجامات"), image: "pajamas", description: L("Soft pajama sets and sleep shirts for slow nights.", "أطقم بيجامات وقمصان نوم ناعمة لليالي الهادئة.") },
  { slug: "gift-boxes", name: L("Gift boxes", "صناديق الهدايا"), image: "gift-box", description: L("Ready-to-give boxes, wrapped by hand.", "صناديق هدايا جاهزة ومغلّفة يدويًا.") },
  { slug: "loungewear", name: L("Loungewear", "ملابس المنزل"), image: "pajamas-3", description: L("Robes, slippers and layers for staying in.", "أرواب وشباشب وطبقات دافئة للبقاء في البيت.") },
  { slug: "accessories", name: L("Accessories", "إكسسوارات"), image: "gift-box-2", description: L("Totes and small carry goods.", "حقائب ومستلزمات حمل صغيرة.") },
  { slug: "knits", name: L("Cosy knits", "تريكو دافئ"), parent: "loungewear", description: L("Soft layers for cool evenings.", "طبقات ناعمة للأمسيات الباردة.") },
  { slug: "lounge-pants", name: L("Lounge pants", "بناطيل المنزل"), parent: "loungewear", description: L("Easy pants for long evenings at home.", "بناطيل مريحة لأمسيات طويلة في البيت.") },
  { slug: "mugs-cups", name: L("Mugs & cups", "أكواب وفناجين"), description: L("Mugs, cups and sets to give or keep.", "أكواب وفناجين وأطقم للإهداء أو للاقتناء.") },
];
const collectionsData = [
  { slug: "pajama-party", name: L("Pajama party", "سهرة البيجامات"), image: "pajamas", description: L("Pajamas in soft prints, made for lazy mornings and long chats.", "بيجامات بطبعات ناعمة لصباحات كسولة وسهرات طويلة.") },
  { slug: "gifts-in-a-box", name: L("Gifts in a box", "هدايا في صندوق"), image: "gift-box", description: L("Thoughtful boxes, filled and wrapped for you.", "صناديق مدروسة نملؤها ونغلّفها لك.") },
  { slug: "cosy-nights", name: L("Cosy nights", "ليالي الدفء"), image: "pajamas-2", description: L("Robes, slippers and knits for cool nights in.", "أرواب وشباشب وتريكو لليالي الباردة في البيت.") },
];
const brandsData = [
  { slug: "sukkar-qamar", name: L("Sukkar & Qamar", "سُكّر وقمر"), description: L("Our own pajamas and loungewear, made for the studio.", "بيجاماتنا وملابس المنزل الخاصة، صُنعت لاستوديو سُكّر وقمر.") },
  { slug: "cherry-lane", name: L("Cherry Lane Studio", "ستوديو شارع الكرز"), description: L("Gift boxes and ceramics from a small studio in Alexandria.", "صناديق هدايا وخزف من استوديو صغير في الإسكندرية.") },
];
const sizeGuidesData = [
  {
    name: L("Pajama size guide", "دليل مقاسات البيجامات"),
    description: L("Garment measurements in centimetres, laid flat.", "قياسات القطعة بالسنتيمتر وهي مسطّحة."),
    chartData: { headers: ["Size", "Chest (cm)", "Length (cm)", "Sleeve (cm)"], rows: [["S", "104", "74", "62"], ["M", "108", "76", "63"], ["L", "114", "78", "64"], ["XL", "120", "80", "65"], ["XXL", "126", "82", "66"]] },
  },
  {
    name: L("Lounge pants size guide", "دليل مقاسات بناطيل المنزل"),
    description: L("Waist and inseam in inches.", "الخصر والطول الداخلي بالبوصة."),
    chartData: { headers: ["Waist (in)", "Waist (cm)", "Hip (cm)"], rows: [["30", "76", "98"], ["32", "81", "103"], ["34", "86", "108"], ["36", "91", "113"]] },
  },
];


const products = [
  {
    slug: "heart-print-pajama-set", name: L("Heart-print pajama set", "طقم بيجامة بطبعة القلوب"), category: "pajamas", collections: ["pajama-party"], brand: "sukkar-qamar", sizeGuide: 0, images: ["pajamas", "pajamas-2"], axes: [axis("colour", "Colour", "اللون", [["rose", "Rose", "وردي", "#E3A9A2"], ["cream", "Cream", "كريمي", "#F1E4D3"], ["plum", "Plum", "برقوقي داكن", "#5B3A4E"]]), plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL", "XXL"])],
    description: L("A long-sleeved shirt and matching trousers in a soft cotton jersey, printed with small hearts and piped in white. A chest pocket, flower-shaped buttons and an elastic waist. Relaxed through the body; size down for a closer fit.", "قميص بأكمام طويلة وبنطلون بنفس القماش من جيرسيه قطني ناعم، مطبوع بقلوب صغيرة ومزيّن بحافة بيضاء. جيب على الصدر وأزرار على شكل زهرة وخصر مطاطي. قصّة مريحة؛ اختر مقاسًا أصغر لقَصّة أقرب."),
    specs: [spec("Fabric", "الخامة", "100% cotton jersey, 190 g/m²", "جيرسيه قطن ١٠٠٪، ١٩٠ جم/م²"), spec("Fit", "القصّة", "Relaxed", "مريحة"), spec("Length (M)", "الطول (M)", "76 cm", "٧٦ سم"), spec("Care", "العناية", "Machine wash 30°C, dry flat", "غسيل آلي ٣٠° وتجفيف أفقي")],
    variants: mk("PJS", cross([["colour", ["rose", "cream", "plum"]], ["size", ["S", "M", "L", "XL", "XXL"]]]), "1450.00", {
      notMade: (c) => c.colour === "plum" && c.size === "XXL", soldOut: (c) => c.colour === "cream" && c.size === "M", low: (c) => c.colour === "rose" && c.size === "L",
      gallery: (c) => (c.colour === "rose" ? ["pajamas", "pajamas-2"] : c.colour === "cream" ? ["pajamas-3"] : null),
    }),
    added: "2026-09-28",
  },
  {
    slug: "long-sleeve-sleep-shirt", name: L("Long-sleeve sleep shirt", "قميص نوم بأكمام طويلة"), category: "pajamas", collections: ["pajama-party"], brand: "sukkar-qamar", sizeGuide: 0, images: ["pajamas-3"], axes: [plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL"])],
    description: L("A long-sleeved sleep shirt in the same soft cotton, with a relaxed back for easy movement.", "قميص نوم بأكمام طويلة من نفس القطن الناعم، بقصّة واسعة في الظهر لحرية الحركة."),
    specs: [spec("Fabric", "الخامة", "100% cotton", "١٠٠٪ قطن"), spec("Fit", "القصّة", "Regular", "عادية")],
    variants: mk("SLS", cross([["size", ["S", "M", "L", "XL"]]]), "1250.00", { compareAt: "1490.00" }), added: "2026-10-04",
  },
  {
    slug: "quilted-lounge-robe", name: L("Quilted lounge robe", "روب منزلي مبطّن"), category: "loungewear", collections: ["cosy-nights"], brand: "sukkar-qamar", images: ["pajamas-2"], axes: [plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL"])],
    description: L("A quilted robe with a soft inner layer and deep pockets, warm enough for cool evenings at home.", "روب مبطّن ببطانة داخلية ناعمة وجيوب عميقة، دافئ بما يكفي لأمسيات البيت الباردة."),
    specs: [spec("Fabric", "الخامة", "80% cotton, 20% polyester", "٨٠٪ قطن، ٢٠٪ بوليستر"), spec("Pockets", "الجيوب", "2", "٢")],
    variants: mk("QLR", cross([["size", ["S", "M", "L", "XL"]]]), "2850.00", { compareAt: "3400.00", soldOut: (c) => c.size === "S" }), added: "2026-09-12",
  },
  {
    slug: "cosy-knit-cardigan", name: L("Cosy knit cardigan", "كارديجان تريكو دافئ"), category: "knits", collections: ["cosy-nights"], brand: "sukkar-qamar", sizeGuide: 0, images: ["pajamas-3"], axes: [plainAxis("size", "Size", "المقاس", ["S", "M", "L", "XL"])],
    description: L("A fine-gauge knit cardigan that layers over pajamas without bulk.", "كارديجان من التريكو الناعم يُلبس فوق البيجاما دون ثقل."),
    specs: [spec("Fabric", "الخامة", "100% soft acrylic knit", "تريكو أكريليك ناعم ١٠٠٪")],
    variants: mk("CKC", cross([["size", ["S", "M", "L", "XL"]]]), "1950.00"), added: "2026-10-08",
  },
  {
    slug: "brushed-lounge-pants", name: L("Brushed lounge pants", "بنطلون منزلي مُبطّن الوجه"), category: "lounge-pants", collections: ["cosy-nights"], brand: "sukkar-qamar", sizeGuide: 1, images: ["pajamas-2"], axes: [plainAxis("waist", "Waist", "الخصر", ["30", "32", "34", "36"]), plainAxis("length", "Length", "الطول", ["30", "32", "34"])],
    description: L("Mid-weight brushed cotton with a soft elastic waist and a relaxed leg.", "قطن مُمشَّط متوسط الوزن بخصر مطاطي ناعم وقَصّة ساق مريحة."),
    specs: [spec("Fabric", "الخامة", "Brushed cotton jersey", "جيرسيه قطن مُمشَّط"), spec("Rise", "ارتفاع الخصر", "Mid", "متوسط")],
    variants: mk("BLP", cross([["waist", ["30", "32", "34", "36"]], ["length", ["30", "32", "34"]]]), "1650.00", { notMade: (c) => c.waist === "30" && c.length === "34", soldOut: (c) => c.waist === "32" && c.length === "32" }), added: "2026-08-30",
  },
  {
    slug: "satin-sleep-mask-set", name: L("Satin sleep mask and scrunchie set", "طقم قناع نوم وإكسسوار شعر من الساتان"), category: "loungewear", collections: ["gifts-in-a-box", "cosy-nights"], brand: "sukkar-qamar", images: ["pajamas-3", "pajamas"], axes: [],
    description: L("A satin sleep mask with a matching scrunchie, packed in a small gift pouch.", "قناع نوم من الساتان مع إكسسوار شعر متناسق، في كيس هدايا صغير."),
    specs: [spec("Fabric", "الخامة", "Washable satin", "ساتان قابل للغسل"), spec("Pieces", "القطع", "2", "٢")],
    variants: single("MSK-ONE", "1650.00", LOW), added: "2026-09-20", // axis-less, single low-stock variant
  },
  {
    slug: "padded-gift-tote", name: L("Padded gift tote", "حقيبة هدايا مبطّنة"), category: "accessories", collections: [], brand: "sukkar-qamar", images: ["gift-box-2"], axes: [],
    description: L("A roomy, padded tote that carries a gift box and stands on its own.", "حقيبة واسعة مبطّنة تتّسع لصندوق هدايا وتقف بمفردها."),
    specs: [spec("Capacity", "السعة", "22 L", "٢٢ لترًا")], variants: single("TOT-ONE", "690.00"), added: "2026-07-14",
  },
  {
    slug: "shearling-house-slippers", name: L("Shearling house slippers", "شبشب منزلي بفرو ناعم"), category: "loungewear", collections: ["cosy-nights"], brand: "sukkar-qamar", images: ["pajamas"], axes: [plainAxis("size", "Size", "المقاس", ["36", "37", "38", "39", "40", "41"])],
    description: L("Warm house slippers lined with soft faux shearling, on a quiet rubber sole.", "شبشب منزلي دافئ ببطانة من الفرو الصناعي الناعم ونعل مطاطي هادئ."),
    specs: [spec("Lining", "البطانة", "Faux shearling", "فرو صناعي"), spec("Sole", "النعل", "Rubber", "مطاط")],
    variants: mk("SLP", cross([["size", ["36", "37", "38", "39", "40", "41"]]]), "3900.00", { soldOut: (c) => c.size === "41", low: (c) => c.size === "40" }), added: "2026-09-02",
  },
  {
    slug: "pajama-gift-box", name: L("Pajama gift box", "صندوق هدية البيجاما"), category: "gift-boxes", collections: ["gifts-in-a-box"], brand: "cherry-lane", images: ["gift-box", "gift-box-2"], axes: [axis("box", "Box", "الصندوق", [["small", "Small box", "صندوق صغير"], ["large", "Large box", "صندوق كبير"]])],
    description: L("A pajama set folded into a gift box with a pair of socks, a mug and a tin of hot chocolate, tied with a ribbon. The large box adds a biscuit and a handwritten card.", "طقم بيجاما مطوي داخل صندوق هدية مع جوربين وكوب وعلبة شوكولاتة ساخنة، ومربوط بشريط. يضيف الصندوق الكبير بسكويتة وبطاقة مكتوبة بخط اليد."),
    specs: [spec("Contents (small box)", "المحتويات (الصندوق الصغير)", "Pajama set · socks · mug", "طقم بيجاما · جوارب · كوب"), spec("Wrapping", "التغليف", "Ribbon and tissue", "شريط وورق حرير"), spec("Card", "البطاقة", "Handwritten, free", "بخط اليد، مجانية"), spec("Box", "الصندوق", "Rigid card, 30 x 30 cm", "كرتون صلب، ٣٠ × ٣٠ سم")],
    variants: mk("PGB", cross([["box", ["small", "large"]]]), (c) => (c.box === "small" ? "1850.00" : "2950.00")), added: "2026-10-01",
  },
  {
    slug: "cocoa-treat-box", name: L("Hot chocolate treat box", "صندوق الشوكولاتة الساخنة"), category: "gift-boxes", collections: ["gifts-in-a-box"], brand: "cherry-lane", images: ["gift-box-2"], axes: [],
    description: L("A small box with a tin of hot chocolate, a heart biscuit and a speckled mug.", "صندوق صغير بعلبة شوكولاتة ساخنة وبسكويتة على شكل قلب وكوب مرقّط."),
    specs: [spec("Hot chocolate", "الشوكولاتة الساخنة", "200 g tin", "علبة ٢٠٠ جم"), spec("Mug", "الكوب", "350 ml stoneware", "خزف ٣٥٠ مل"), spec("Wrapping", "التغليف", "Ribbon and tissue", "شريط وورق حرير")],
    variants: single("TRT-BOX", "1850.00"), added: "2026-09-25",
  },
  {
    slug: "sweet-surprise-box", name: L("Sweet surprise gift box", "صندوق المفاجأة الحلوة"), category: "gift-boxes", collections: ["gifts-in-a-box"], brand: "cherry-lane", images: ["gift-box"], axes: [axis("wrap", "Wrapping", "التغليف", [["blush", "Blush pink", "وردي فاتح"], ["ivory", "Ivory", "عاجي"]])],
    description: L("A box of small treats and a keepsake, wrapped in your choice of paper and ribbon.", "صندوق من الحلويات الصغيرة وهدية تذكارية، مغلّف بالورق والشريط الذي تختاره."),
    specs: [spec("Contents", "المحتويات", "Treats and a keepsake", "حلويات وهدية تذكارية")],
    variants: mk("SSB", cross([["wrap", ["blush", "ivory"]]]), (c) => (c.wrap === "blush" ? "640.00" : "720.00")), added: "2026-08-18",
  },
  {
    slug: "letterbox-gift-set", name: L("Letterbox gift set", "طقم هدية بحجم الرسائل"), category: "gift-boxes", collections: ["gifts-in-a-box"], brand: "cherry-lane", images: ["gift-box-2"], axes: [],
    description: L("A flat gift set of cosy socks and a handwritten card that fits through a letterbox.", "طقم هدية مسطّح من جوارب دافئة وبطاقة بخط اليد، يمرّ من فتحة صندوق البريد."),
    specs: [spec("Contents", "المحتويات", "Socks and a card", "جوارب وبطاقة")], variants: single("LTR-ONE", "980.00"), added: "2026-07-30",
  },
  {
    slug: "heart-ceramic-mug", name: L("Heart ceramic mug", "كوب سيراميك بقلب"), category: "mugs-cups", collections: [], brand: "cherry-lane", images: ["mug"], axes: [axis("capacity", "Capacity", "السعة", [["250", "250 ml", "٢٥٠ مل"], ["350", "350 ml", "٣٥٠ مل"]])],
    description: L("A speckled matt mug with a big pink heart and a natural clay base.", "كوب مرقّط مطفي بقلب وردي كبير وقاعدة من الطين الطبيعي."),
    specs: [spec("Finish", "الطلاء", "Matt speckled glaze", "طلاء مطفي مرقّط")],
    variants: mk("MUG", cross([["capacity", ["250", "350"]]]), (c) => (c.capacity === "250" ? "450.00" : "620.00"), { soldOut: (c) => c.capacity === "350" }), added: "2026-06-11",
  },
  {
    slug: "mug-and-biscuit-set", name: L("Mug and biscuit gift set", "طقم كوب وبسكويت للإهداء"), category: "mugs-cups", collections: ["gifts-in-a-box"], brand: "sukkar-qamar", images: ["mug-2"], axes: [],
    description: L("A speckled mug and a heart-stamped biscuit in a small gift box, with a card.", "كوب مرقّط وبسكويتة مختومة بقلب في صندوق هدية صغير مع بطاقة."),
    specs: [spec("Contents", "المحتويات", "Mug, biscuit, card", "كوب وبسكويت وبطاقة")], variants: single("MBS-2", "1190.00"), added: "2026-09-08",
  },
  {
    slug: "speckled-espresso-cup", name: L("Speckled espresso cup", "فنجان إسبريسو مرقّط"), category: "mugs-cups", collections: ["gifts-in-a-box"], brand: "cherry-lane", images: ["mug-2"], axes: [],
    description: L("A small stoneware cup in the same speckled glaze, sized for a short, strong espresso.", "فنجان صغير من الخزف بنفس الطلاء المرقّط، بحجم مناسب لإسبريسو قصير ومركّز."),
    specs: [spec("Capacity", "السعة", "90 ml", "٩٠ مل"), spec("Material", "الخامة", "Stoneware", "خزف")], variants: single("ESP-ONE", "260.00"), added: "2026-10-06",
  },
  {
    slug: "birthday-surprise-box", name: L("Birthday surprise box", "صندوق مفاجأة عيد الميلاد"), category: "gift-boxes", collections: [], brand: "cherry-lane", images: ["gift-box"], axes: [],
    description: L("A birthday box with a candle, a mug and sweets, wrapped with a ribbon and a handwritten card.", "صندوق عيد ميلاد بشمعة وكوب وحلويات، مغلّف بشريط وبطاقة بخط اليد."),
    specs: [spec("Contents", "المحتويات", "Candle, mug, sweets, card", "شمعة وكوب وحلويات وبطاقة")], variants: single("BDY-ONE", "1390.00", OUT), added: "2026-05-20", // sold out entirely
  },
  { // NO images at all: the storefront and the cart must cope with a product that has nothing to show
    slug: "mug-gift-set", name: L("Mug gift set of four", "طقم هدية أكواب من أربعة"), category: "mugs-cups", collections: ["gifts-in-a-box"], brand: "cherry-lane", images: [], axes: [],
    description: L("Four speckled stoneware mugs in a gift box, in a soft oatmeal glaze.", "أربعة أكواب خزف مرقّطة في صندوق هدية، بطلاء ناعم بلون الشوفان."),
    specs: [spec("Capacity (each)", "السعة (للواحد)", "280 ml", "٢٨٠ مل")], variants: single("MUG-4", "180.00"), added: "2026-09-26",
  },
].sort((a, b) => a.added.localeCompare(b.added)); // create oldest first so "newest" ordering by createdAt matches the fixture

// ---------------------------------------------------------------------------------------------------------------- profile: ci-default (content)
const defaultPages = [
  { slug: "terms", title: L("Terms of Sale", "شروط البيع"), content: L(
    "These terms govern every order placed on Sukkar & Qamar.\n\n1. Prices are in Egyptian pounds and include no delivery fee unless shown at checkout.\n2. An order is confirmed once payment is received or, for cash on delivery, once we confirm it by phone.\n3. We may cancel an order if an item cannot be supplied; you will be refunded in full.\n4. Goods remain ours until paid for.",
    "تنظّم هذه الشروط كل طلب يتم عبر سُكّر وقمر.\n\n١. الأسعار بالجنيه المصري ولا تشمل رسوم التوصيل ما لم تظهر عند إتمام الطلب.\n٢. يتأكد الطلب عند استلام الدفع، أو عند تأكيدنا له هاتفيًا في حالة الدفع عند الاستلام.\n٣. يحق لنا إلغاء الطلب إذا تعذّر توفير أحد الأصناف، وسيُردّ إليك المبلغ كاملًا.\n٤. تبقى البضاعة ملكًا لنا حتى يتم سدادها.") },
  { slug: "privacy", title: L("Privacy Policy", "سياسة الخصوصية"), content: L(
    "We collect only what we need to deliver your order: your name, phone number, address and email. We never sell your data. You can ask us to delete your account at any time by writing to hello@sukkar-qamar.example.",
    "نجمع فقط ما نحتاجه لتوصيل طلبك: الاسم ورقم الهاتف والعنوان والبريد الإلكتروني. لا نبيع بياناتك أبدًا. يمكنك طلب حذف حسابك في أي وقت بمراسلتنا على hello@sukkar-qamar.example.") },
  { slug: "returns", title: L("Returns & Refunds", "الإرجاع والاسترداد"), content: L(
    "You can return unused items within 14 days of delivery. Pajamas and socks must be unworn and unwashed with tags attached; gift boxes must be unopened. Refunds go back to the original payment method within 7 working days of us receiving the item. Items made to order are not returnable.",
    "يمكنك إرجاع الأصناف غير المستخدمة خلال ١٤ يومًا من التسليم. يجب أن تكون البيجامات والجوارب غير ملبوسة وغير مغسولة وعليها البطاقات، وصناديق الهدايا غير مفتوحة. يُردّ المبلغ بنفس وسيلة الدفع خلال ٧ أيام عمل من استلامنا القطعة. الأصناف المصنوعة حسب الطلب غير قابلة للإرجاع.") },
  { slug: "shipping", title: L("Delivery & Collection", "التوصيل والاستلام"), content: L(
    "We deliver across Egypt in 2 to 4 working days depending on your governorate, with fees shown at checkout. You can also collect free from our Zamalek studio or our Maadi pickup point during opening hours.",
    "نوصّل لكل محافظات مصر خلال ٢ إلى ٤ أيام عمل حسب المحافظة، وتظهر الرسوم عند إتمام الطلب. ويمكنك أيضًا الاستلام مجانًا من استوديو الزمالك أو من نقطة المعادي خلال ساعات العمل.") },
  { slug: "contact", title: L("Contact", "اتصل بنا"), content: L(
    "Call or WhatsApp us on +20 100 555 0142, or write to hello@sukkar-qamar.example. We answer every day from 10:00 to 20:00 (Friday from 14:00).",
    "اتصل بنا أو راسلنا على واتساب على +20 100 555 0142، أو اكتب إلى hello@sukkar-qamar.example. نرد يوميًا من ١٠ صباحًا حتى ٨ مساءً (الجمعة من ٢ ظهرًا).") },
  { slug: "about", title: L("Our studio", "عن الاستوديو"), content: L(
    "Sukkar & Qamar began in a single room in Zamalek. We choose soft pajamas and speckled mugs, fill the boxes ourselves and wrap everything by hand, so that a gift feels as thoughtful as it was meant to be.",
    "بدأ سُكّر وقمر في غرفة واحدة في الزمالك. نختار بيجامات ناعمة وأكوابًا مرقّطة، ونملأ الصناديق بأنفسنا ونغلّف كل شيء يدويًا، لتصل الهدية بكل ما فيها من اهتمام.") },
  { slug: "care", title: L("Caring for pajamas and mugs", "العناية بالبيجامات والأكواب"), content: L(
    "Wash pajamas at 30°C with similar colours and dry them flat; they soften with every wash. Wash mugs by hand or on a gentle dishwasher cycle, and avoid the microwave for any piece with a metallic rim.",
    "اغسل البيجامات على ٣٠° مع الألوان المتشابهة وجفّفها أفقيًا؛ فهي تلين مع كل غسلة. اغسل الأكواب يدويًا أو في دورة لطيفة بغسالة الصحون، وتجنّب الميكروويف لأي قطعة بحافة معدنية.") },
];

const defaultPromotions = [
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
const defaultContent = {
  announcements: [{ message: L("New: Gifts in a box — wrapped by hand and ready to give", "جديد: هدايا في صندوق — مغلّفة يدويًا وجاهزة للإهداء"), target: t("collection", "gifts-in-a-box"), enabled: true }],
  headerNavigation: [
    { target: t("category", "pajamas"), label: L("Pajamas", "بيجامات") },
    { target: t("category", "loungewear"), label: L("Loungewear", "ملابس المنزل") },
    { target: t("category", "gift-boxes"), label: L("Gift boxes", "صناديق الهدايا") },
    { target: t("category", "mugs-cups"), label: L("Mugs & cups", "أكواب وفناجين") },
    { target: t("collection", "pajama-party"), label: L("Pajama party", "سهرة البيجامات") },
    { target: t("collection", "gifts-in-a-box"), label: L("Gifts in a box", "هدايا في صندوق") },
  ],
  footerNavigation: [
    { target: t("page", "about"), label: L("Our studio", "عن الاستوديو") },
    { target: t("page", "care"), label: L("Caring for pajamas and mugs", "العناية بالبيجامات والأكواب") },
    { target: t("collection", "cosy-nights"), label: L("Cosy nights", "ليالي الدفء") },
  ],
  homeSections: [
    { type: "campaignHero", headline: L("Gifts that feel thought through", "هدايا تُشعرك بالاهتمام"), subline: L("Soft pajamas for the nights in, boxes wrapped for the ones you love.", "بيجامات ناعمة لليالي البيت، وصناديق مغلّفة لمن تحبّ."), actionLabel: L("Explore gifts in a box", "اكتشف هدايا في صندوق"), target: t("collection", "gifts-in-a-box") },
    { type: "categoryTiles", heading: L("Shop by category", "تسوق حسب الفئة"), categories: ["pajamas", "gift-boxes", "loungewear", "accessories"] },
    { type: "collectionStory", collection: "pajama-party", heading: L("Pajama party", "سهرة البيجامات") },
    { type: "productRail", source: "collection", collection: "gifts-in-a-box", heading: L("Gifts in a box", "هدايا في صندوق") },
    { type: "editorialBand", collection: "gifts-in-a-box", headline: L("Every box wrapped by hand before it leaves the studio", "كل صندوق يُغلَّف باليد قبل أن يغادر الاستوديو") },
    { type: "productRail", source: "newest" },
    { type: "assuranceStrip" },
  ],
};

// ---------------------------------------------------------------------------------------------------------------- profile: ci-alternate
// Brand colours are light and low-contrast on purpose: the backend's contrast derivation has to darken them for light grounds.
// No typography setting: Mimora's typography is fixed in the storefront's code, and the template's "contemporary"
// pairing measurably breaks the proof's layout-shift budget (CLS 0.062 > 0.05 on the home hero at ar/375, measured 2026-10-30).
const alternateTheme = {
  brand: { primary: "#E9C46A", accent: "#2A9D8F", surface: "#FBF7F0", text: "#1F1A14", radiusScale: 1.5 },
  theme: { defaultGround: "dark", darkEnabled: true, allowVisitorChoice: false, tokenOverrides: [] },
};
const alternateFulfilment = {
  deliveryEnabled: true, pickupEnabled: false, defaultDispatchLeadDays: 2, cutoffTime: "14:00", maxDaysAhead: 30,
  orderMinimum: "150.00", shippingFeeMode: "FLAT", flatShippingFee: "60.00", allowGuestCheckout: false,
  tax: { mode: "INCLUDED", rate: 14 }, customerCancelWindowMinutes: 10, returnWindowDays: 7,
};
const alternateZones = [
  { name: L("Cairo", "القاهرة"), areas: ["Cairo", "القاهرة", "Giza", "الجيزة"], fee: "75.00", minimumOrder: "0.00", leadDays: 1, active: true, order: 0 },
  { name: L("Alexandria", "الإسكندرية"), areas: ["Alexandria", "الإسكندرية", "Beheira", "البحيرة"], fee: "95.00", minimumOrder: "500.00", leadDays: 3, active: true, order: 1 },
];
const alternateHours = {
  // weekday 0 = Sunday ... 6 = Saturday; Friday opens for the evening only, a split shift otherwise
  weekly: [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, ranges: [{ open: "09:00", close: "13:00" }, { open: "16:00", close: "22:00" }] })).concat([{ weekday: 5, ranges: range("16:00", "22:00") }]),
  exceptions: [{ date: "2027-02-22", closed: true, ranges: [] }],
};
// No COD: both methods need a receipt, so every order starts AWAITING_PAYMENT.
const alternatePayments = {
  methods: [
    { method: "BANK_TRANSFER", enabled: true, order: 0, requiresProof: true, autoCancelMinutes: 2880, verificationWindowMinutes: 1440,
      destination: { accountName: "Sukkar & Qamar Trading", number: "EG380019000500000000263180002" },
      instructions: L("Transfer the exact total to IBAN EG38 0019 0005 0000 0000 2631 8000 2 (Sukkar & Qamar Trading), then upload the transfer receipt.", "حوّل المبلغ بالضبط إلى الآيبان EG38 0019 0005 0000 0000 2631 8000 2 (سُكّر وقمر للتجارة) ثم ارفع إيصال التحويل.") },
    { method: "WALLET_TRANSFER", enabled: true, order: 1, requiresProof: true, autoCancelMinutes: 720, verificationWindowMinutes: 360,
      destination: { accountName: "Sukkar & Qamar", number: "01005550143" },
      instructions: L("Send the exact total to wallet 0100 555 0143, then upload a screenshot of the confirmation.", "أرسل المبلغ بالضبط إلى المحفظة 0100 555 0143 ثم ارفع لقطة شاشة للتأكيد.") },
  ],
};
const alternatePages = [
  { slug: "terms", title: L("Terms of Sale", "شروط البيع"), content: L(
    "Orders at Sukkar & Qamar are paid by bank or wallet transfer.\n\n1. All prices are in Egyptian pounds and include 14% VAT.\n2. Your order is held until we receive your transfer receipt, and is released automatically if none arrives in time.\n3. You need an account to check out so we can track your order.",
    "تُدفع طلبات سُكّر وقمر بالتحويل البنكي أو عبر المحفظة.\n\n١. جميع الأسعار بالجنيه المصري وتشمل ضريبة القيمة المضافة ١٤٪.\n٢. يُحجز طلبك حتى نستلم إيصال التحويل، ويُفرج عنه تلقائيًا إن لم يصل في الوقت المحدد.\n٣. تحتاج إلى حساب لإتمام الطلب حتى نتمكن من متابعته.") },
  { slug: "privacy", title: L("Privacy Policy", "سياسة الخصوصية"), content: L(
    "We keep your name, mobile number, delivery address and order history to fulfil your orders. Transfer receipts are visible only to our payments team. Write to hello@sukkar-qamar.example to export or erase your data.",
    "نحتفظ باسمك ورقم جوالك وعنوان التوصيل وسجل طلباتك لتنفيذ طلباتك. إيصالات التحويل لا يراها إلا فريق المدفوعات. راسلنا على hello@sukkar-qamar.example لتصدير بياناتك أو حذفها.") },
  { slug: "returns", title: L("Returns", "الإرجاع"), content: L(
    "Unused items in their original box can be returned within 7 days of delivery. Refunds are sent back to the account you paid from. Sale items and gift sets with a broken seal cannot be returned.",
    "يمكن إرجاع الأصناف غير المستخدمة في عبوتها الأصلية خلال ٧ أيام من التسليم. يُعاد المبلغ إلى الحساب الذي دفعت منه. لا تُقبل إعادة أصناف التخفيضات ولا أطقم الهدايا مكسورة الختم.") },
  { slug: "delivery", title: L("Delivery", "التوصيل"), content: L(
    "We deliver to Cairo in 1 day and to Alexandria in 3 days after your transfer is confirmed. Delivery is a flat 60 EGP; we do not offer pickup.",
    "نوصّل إلى القاهرة خلال يوم واحد وإلى الإسكندرية خلال ٣ أيام بعد تأكيد التحويل. التوصيل برسم ثابت ٦٠ جنيهًا، ولا نوفّر الاستلام من المتجر.") },
];
// One automatic promotion, different in kind from the default profile's: a percentage off above a subtotal. No coded promotion.
const alternatePromotions = [
  {
    name: L("12% off baskets over 4,000 EGP", "خصم ١٢٪ على السلال فوق ٤٠٠٠ جنيه"), description: L("12% off the whole basket when it reaches 4,000 EGP.", "خصم ١٢٪ على السلة كاملة عند بلوغها ٤٠٠٠ جنيه."),
    type: "PERCENT", value: "12", conditions: { minSubtotal: "4000.00" }, stackable: false, active: true,
  },
];
const alternateContent = {
  announcements: [{ message: L("Sign in to check out. Transfers only: no cash on delivery.", "سجّل الدخول لإتمام الطلب. التحويل فقط: لا دفع عند الاستلام."), enabled: true }],
  headerNavigation: [
    { target: t("category", "mugs-cups"), label: L("Mugs & cups", "أكواب وفناجين") },
    { target: t("category", "pajamas"), label: L("Pajamas", "بيجامات") },
    { target: t("category", "gift-boxes"), label: L("Gift boxes", "صناديق الهدايا") },
    { target: t("collection", "gifts-in-a-box"), label: L("Gifts in a box", "هدايا في صندوق") },
  ],
  footerNavigation: [
    { target: t("page", "delivery"), label: L("Delivery", "التوصيل") },
    { target: t("page", "returns"), label: L("Returns", "الإرجاع") },
  ],
  homeSections: [
    { type: "campaignHero", headline: L("Slow evenings, well wrapped", "أمسيات هادئة بتغليف أنيق"), subline: L("Mugs, pajamas and little gifts for the evening in.", "أكواب وبيجامات وهدايا صغيرة لأمسيات البيت."), actionLabel: L("Shop gifts in a box", "تسوّق هدايا في صندوق"), target: t("collection", "gifts-in-a-box") },
    { type: "productRail", source: "collection", collection: "gifts-in-a-box", heading: L("Gifts in a box", "هدايا في صندوق") },
    { type: "categoryTiles", heading: L("Browse", "تصفّح"), categories: ["mugs-cups", "pajamas", "gift-boxes"] },
    { type: "assuranceStrip" },
  ],
};

// ---------------------------------------------------------------------------------------------------------------- the two fixtures
const shared = { store, brands: brandsData, categories: categoriesData, collections: collectionsData, sizeGuides: sizeGuidesData, products };

export const ciDefault = {
  key: "ci-default", ...shared,
  theme: defaultTheme, fulfilment: defaultFulfilment, zones: defaultZones, pickups: defaultPickups, hours: defaultHours, payments: defaultPayments,
  pages: defaultPages, promotions: defaultPromotions, content: defaultContent,
};
export const ciAlternate = {
  key: "ci-alternate", ...shared,
  theme: alternateTheme, fulfilment: alternateFulfilment, zones: alternateZones, pickups: [], hours: alternateHours, payments: alternatePayments,
  pages: alternatePages, promotions: alternatePromotions, content: alternateContent,
};
