/**
 * Reads and validates `catalog.json` — the shape the catalog importer accepts. Pure: no I/O, no network.
 *
 * {
 *   "products": [{ "sourceImageFilename": "a.jpg",            // or "sourceImageFilenames": ["a.jpg", "b.jpg"] (gallery order)
 *                  "product":  { name, description, slug, categoryId, collectionIds, optionAxes, attributes,
 *                                seoTitle, seoDescription, lifecycle, brandId?, sizeGuide?, publishAt?, order? },
 *                  "variants": [{ sku, optionValues, price, stock, compareAtPrice?, costPrice?, lowStockThreshold?,
 *                                 weight?, length?, width?, height?, unitOfMeasure?, unitsPerSale?, backorderPolicy? }] }],
 *   "productGroupAssignmentSteps": [{ "groupName": { en, ar },
 *                                     "membersInStorefrontOrder": [{ "productSlug", "label": { en, ar } }] }]
 * }
 *
 * The product and variant objects are the existing admin API bodies (`CreateProductDto`, `CreateVariantDto`) minus
 * what the importer supplies itself (`images`, `productId`). Unknown keys are refused rather than silently dropped.
 * The server stays the authority on every rule; these checks exist so a dry run catches mistakes before anything
 * is uploaded or created.
 */

export const PRODUCT_KEYS = ["name", "description", "slug", "categoryId", "collectionIds", "brandId", "sizeGuide", "optionAxes", "attributes", "seoTitle", "seoDescription", "lifecycle", "publishAt", "order"];
export const VARIANT_KEYS = ["sku", "optionValues", "price", "compareAtPrice", "costPrice", "stock", "lowStockThreshold", "weight", "length", "width", "height", "unitOfMeasure", "unitsPerSale", "backorderPolicy"];
const LIFECYCLES = ["draft", "published", "archived"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OBJECT_ID = /^[0-9a-f]{24}$/;
/** The server's money pattern (src/common/format/money-input.ts): at most 13 digits before the point, which a BSON Double stores exactly. */
const MONEY = /^\d{1,13}(\.\d{1,2})?$/;
/** Mirrors the server's group rules (`product-group-rules.ts`) so a bad group is caught BEFORE its products are created. */
export const MAX_GROUP_MEMBERS = 30;
export const MAX_GROUP_LABEL_LENGTH = 80;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * @param {unknown} json the parsed catalog.json
 * @returns {{ products: Array<{ index: number, slug: string, images: string[], product: Record<string, unknown>, variants: Array<Record<string, unknown>> }>,
 *             groups: Array<{ index: number, key: string, name: { en: string, ar: string }, members: Array<{ productSlug: string, label: { en: string, ar: string } }> }>,
 *             errors: string[], warnings: string[] }}
 */
export function parseCatalog(json) {
  const errors = [];
  const warnings = [];
  const products = [];
  const groups = [];
  if (!isObject(json)) return { products, groups, errors: ["catalog.json must be a JSON object with a \"products\" array."], warnings };
  for (const key of Object.keys(json)) if (!["products", "productGroupAssignmentSteps"].includes(key)) errors.push(`Unknown top-level key "${key}".`);
  if (!Array.isArray(json.products) || json.products.length === 0) errors.push("\"products\" must be a non-empty array.");

  const slugs = new Set();
  const skus = new Map();
  for (const [index, entry] of (Array.isArray(json.products) ? json.products : []).entries()) {
    const at = `products[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${at} must be an object.`);
      continue;
    }
    for (const key of Object.keys(entry)) if (!["sourceImageFilename", "sourceImageFilenames", "product", "variants"].includes(key)) errors.push(`${at}: unknown key "${key}".`);

    const images = Array.isArray(entry.sourceImageFilenames) ? entry.sourceImageFilenames.map(text) : text(entry.sourceImageFilename) ? [text(entry.sourceImageFilename)] : [];
    if (entry.sourceImageFilename !== undefined && entry.sourceImageFilenames !== undefined) errors.push(`${at}: give "sourceImageFilename" or "sourceImageFilenames", not both.`);
    if (images.length === 0 || images.some((name) => !name)) errors.push(`${at}: "sourceImageFilename" is required.`);
    if (new Set(images).size !== images.length) errors.push(`${at}: an image is listed twice.`);

    const product = isObject(entry.product) ? entry.product : null;
    if (!product) {
      errors.push(`${at}: "product" must be an object.`);
      continue;
    }
    const slug = text(product.slug);
    const where = `${at} (${slug || "no slug"})`;
    for (const key of Object.keys(product)) if (!PRODUCT_KEYS.includes(key)) errors.push(`${where}: unknown product key "${key}"${key === "images" ? " — images come from the image files, not the JSON" : ""}.`);
    if (!SLUG.test(slug) || slug.length > 200) errors.push(`${where}: slug must be lowercase letters, digits and single dashes (max 200).`);
    else if (slugs.has(slug)) errors.push(`${where}: slug "${slug}" is used twice in this file.`);
    slugs.add(slug);
    if (!isObject(product.name) || !text(product.name.en) || !text(product.name.ar)) errors.push(`${where}: name needs both "en" and "ar".`);
    if (!isObject(product.description)) errors.push(`${where}: description must be { en, ar } (use "" for an empty one).`);
    if (!OBJECT_ID.test(text(product.categoryId))) errors.push(`${where}: categoryId must be a 24-character id.`);
    if (product.collectionIds !== undefined && (!Array.isArray(product.collectionIds) || product.collectionIds.some((id) => !OBJECT_ID.test(text(id))))) errors.push(`${where}: collectionIds must be an array of 24-character ids.`);
    if (!LIFECYCLES.includes(product.lifecycle)) errors.push(`${where}: lifecycle must be one of ${LIFECYCLES.join(", ")} (it is never assumed).`);
    const axes = Array.isArray(product.optionAxes) ? product.optionAxes : [];
    if (product.optionAxes !== undefined && !Array.isArray(product.optionAxes)) errors.push(`${where}: optionAxes must be an array.`);
    if (product.attributes !== undefined && !Array.isArray(product.attributes)) errors.push(`${where}: attributes must be an array.`);
    const axisKeys = axes.map((axis) => (isObject(axis) ? text(axis.key) : ""));

    const variants = Array.isArray(entry.variants) ? entry.variants : [];
    if (variants.length === 0) errors.push(`${where}: at least one variant is required (a variant carries the price and stock).`);
    if (axisKeys.length === 0 && variants.length > 1) errors.push(`${where}: a product without options can have only one variant — add an option (e.g. size) to sell several.`);
    const combinations = new Map();
    for (const [vIndex, variant] of variants.entries()) {
      const vAt = `${where} variants[${vIndex}]`;
      if (!isObject(variant)) {
        errors.push(`${vAt} must be an object.`);
        continue;
      }
      for (const key of Object.keys(variant)) if (!VARIANT_KEYS.includes(key)) errors.push(`${vAt}: unknown variant key "${key}".`);
      const sku = text(variant.sku);
      if (!sku) errors.push(`${vAt}: sku is required.`);
      else if (skus.has(sku)) errors.push(`${vAt}: SKU "${sku}" is also used by ${skus.get(sku)}.`);
      else skus.set(sku, slug);
      if (typeof variant.price !== "string" || !MONEY.test(variant.price)) errors.push(`${vAt}: price must be a decimal string like "100.00" (never a number).`);
      if (!Number.isInteger(variant.stock) || variant.stock < 0) errors.push(`${vAt}: stock must be a whole number ≥ 0.`);
      const values = Array.isArray(variant.optionValues) ? variant.optionValues : null;
      if (!values) errors.push(`${vAt}: optionValues must be an array ([] for a product without options).`);
      else {
        const keys = values.map((value) => (isObject(value) ? text(value.key) : ""));
        if (keys.length !== axisKeys.length || axisKeys.some((key) => !keys.includes(key))) errors.push(`${vAt}: optionValues must give one value for each of the product's options (${axisKeys.join(", ") || "none"}).`);
        else if (axisKeys.length > 0) {
          const combination = axisKeys.map((key) => text(values.find((value) => text(value.key) === key)?.value).toLowerCase()).join("|");
          if (combinations.has(combination)) errors.push(`${vAt}: the same option values as variant ${combinations.get(combination)}.`);
          combinations.set(combination, sku || vIndex);
        }
      }
    }
    products.push({ index, slug, images, product, variants });
  }

  const productBySlug = new Map(products.map((entry) => [entry.slug, entry]));
  const grouped = new Map();
  const steps = json.productGroupAssignmentSteps ?? [];
  if (!Array.isArray(steps)) errors.push("\"productGroupAssignmentSteps\" must be an array.");
  for (const [index, step] of (Array.isArray(steps) ? steps : []).entries()) {
    const at = `productGroupAssignmentSteps[${index}]`;
    if (!isObject(step)) {
      errors.push(`${at} must be an object.`);
      continue;
    }
    const name = { en: text(step.groupName?.en), ar: text(step.groupName?.ar) };
    if (!name.en && !name.ar) errors.push(`${at}: groupName needs a name.`);
    const list = Array.isArray(step.membersInStorefrontOrder) ? step.membersInStorefrontOrder : [];
    if (list.length === 0) errors.push(`${at}: membersInStorefrontOrder must list the group's products.`);
    if (list.length === 1) warnings.push(`${at}: a group with one product shows no alternatives on the storefront.`);
    if (list.length > MAX_GROUP_MEMBERS) errors.push(`${at}: a group can hold at most ${MAX_GROUP_MEMBERS} products.`);
    const labels = { en: new Set(), ar: new Set() };
    const members = [];
    for (const [mIndex, member] of list.entries()) {
      const mAt = `${at} member ${mIndex + 1}`;
      const productSlug = text(member?.productSlug);
      const label = { en: text(member?.label?.en), ar: text(member?.label?.ar) };
      if (!productBySlug.has(productSlug)) errors.push(`${mAt}: "${productSlug}" is not a product in this file (a batch only groups its own products).`);
      if (grouped.has(productSlug)) errors.push(`${mAt}: "${productSlug}" is already in group ${grouped.get(productSlug)} (a product is in one group).`);
      grouped.set(productSlug, `"${name.en || name.ar}"`);
      for (const locale of ["en", "ar"]) {
        if (!label[locale]) errors.push(`${mAt}: label needs "${locale}".`);
        else if (label[locale].length > MAX_GROUP_LABEL_LENGTH) errors.push(`${mAt}: label.${locale} is longer than ${MAX_GROUP_LABEL_LENGTH} characters.`);
        else if (labels[locale].has(label[locale].toLowerCase())) errors.push(`${mAt}: label.${locale} "${label[locale]}" is used twice in this group.`);
        labels[locale].add(label[locale].toLowerCase());
      }
      members.push({ productSlug, label });
    }
    groups.push({ index, key: groupKey(name), name, members });
  }
  const keys = new Set();
  for (const group of groups) {
    if (keys.has(group.key)) errors.push(`Two groups are named "${group.name.en || group.name.ar}".`);
    keys.add(group.key);
  }
  return { products, groups, errors, warnings };
}

/** How a group is recognised across runs: its name. Two groups in one batch may not share one. */
export function groupKey(name) {
  return `${name.en.trim().toLowerCase()}|${name.ar.trim()}`;
}
