/**
 * Decides what an import run will do, from four inputs: the validated catalog, the image files, what the store holds
 * right now (`remote`), and what earlier runs of this importer did against this store (`state`). Pure.
 *
 * Product status:
 *   create — no product has this slug: upload its image(s), create it (as a draft), add its variants, then set the
 *            lifecycle the JSON asks for.
 *   resume — an EARLIER RUN OF THIS IMPORTER created it (the state file names its id) but did not finish: only the
 *            missing steps run. Its image is never re-uploaded.
 *   done   — an earlier run finished it. Nothing runs, even if staff have since edited it — never overwritten.
 *   skip   — a product with this slug exists that this importer did NOT create. Never touched; reported as a conflict.
 * Group status: create / update (created by an earlier run, membership not yet saved) / done / blocked.
 *
 * Anything in `blocking` stops `--execute` before the first write.
 */

/** The body `POST /admin/products` gets: the JSON product, created as a DRAFT with the uploaded images. */
export function productBody(product, images) {
  const rest = { ...product };
  delete rest.lifecycle;
  return {
    collectionIds: [],
    optionAxes: [],
    attributes: [],
    ...rest,
    images,
    lifecycle: "draft",
  };
}

/** The body `POST /admin/variants` gets. */
export function variantBody(productId, variant) {
  return { ...variant, productId };
}

/**
 * @param {{ catalog: ReturnType<typeof import("./catalog.mjs").parseCatalog>,
 *           images: ReturnType<typeof import("./images.mjs").inspectImages>,
 *           remote: { categories: Set<string>, collections: Set<string>,
 *                     productsBySlug: Map<string, { id: string, slug: string, lifecycle: string, group?: { groupId: string, label: object, order: number } }>,
 *                     skuOwner: Map<string, string>, groupIds: Set<string> },
 *           state: { images: Record<string, { filename: string, asset: object }>,
 *                    products: Record<string, { productId: string, variants: Record<string, string>, lifecycleSet?: boolean, completed?: boolean }>,
 *                    groups: Record<string, { groupId: string, completed?: boolean }> } }} input
 */
export function buildPlan({ catalog, images, remote, state }) {
  const blocking = [...catalog.errors];
  const warnings = [...catalog.warnings];
  const products = [];

  for (const entry of catalog.products) {
    const { slug, product } = entry;
    const existing = remote.productsBySlug.get(slug);
    const recorded = state.products[slug];
    // A create whose response never arrived (crash, lost connection): the state recorded the INTENT and the image it
    // was sending. The product is adopted only if it carries exactly that freshly uploaded image — nobody else's can.
    const adopted = Boolean(existing && recorded && !recorded.productId && recorded.pending?.imagePublicId && remote.imagesBySlug?.get(slug)?.[0] === recorded.pending.imagePublicId);
    const owned = Boolean(existing && recorded && (recorded.productId === existing.id || adopted));
    if (adopted) warnings.push(`${slug}: created by an earlier run whose response was lost — recognised by its uploaded image and resumed.`);
    const reasons = [];
    let status;
    if (existing && !owned) status = "skip";
    else if (owned && recorded.completed) status = "done";
    else if (owned) status = "resume";
    else status = "create";
    if (!existing && recorded?.productId) warnings.push(`${slug}: the state file remembers creating it, but the store has no such product now — it will be created again.`);
    if (status === "skip") warnings.push(`${slug}: a product with this slug already exists in the store and was not created by this importer — it is skipped and left exactly as it is.`);

    const plannedImages = entry.images.map((filename) => {
      const file = images.files.get(filename);
      const remembered = file?.sha256 ? state.images[file.sha256] : undefined;
      const action = status !== "create" ? "none" : remembered ? "reuse" : "upload";
      if (action !== "none" && (!file || !file.exists)) blocking.push(`${slug}: image "${filename}" ${file?.problem ?? "not found"}${file?.suggestion ? ` — did you mean "${file.suggestion}"? (the importer never guesses; fix the name in catalog.json)` : ""}.`);
      else if (action === "upload" && file.problem) blocking.push(`${slug}: image "${filename}" is ${file.problem}.`);
      return { filename, action, sha256: file?.sha256, width: file?.width, height: file?.height, bytes: file?.bytes, mime: file?.mime, asset: remembered?.asset };
    });

    if (status === "create" || status === "resume") {
      if (!remote.categories.has(String(product.categoryId))) blocking.push(`${slug}: category ${product.categoryId} does not exist in the store.`);
      for (const id of product.collectionIds ?? []) if (!remote.collections.has(String(id))) blocking.push(`${slug}: collection ${id} does not exist in the store.`);
    }

    const productId = owned ? existing.id : undefined;
    const variants = entry.variants.map((variant) => {
      const owner = remote.skuOwner.get(variant.sku);
      let action = "create";
      if (status === "skip" || status === "done") action = "none";
      else if (owner && owner === productId) action = "exists";
      else if (owner) blocking.push(`${slug}: SKU "${variant.sku}" already belongs to another product.`);
      return { sku: variant.sku, action, body: variant };
    });

    const target = product.lifecycle;
    const lifecycle = {
      target,
      action: status === "create" ? (target === "draft" ? "none" : "set") : status === "resume" ? (existing.lifecycle === target ? "none" : "set") : "none",
    };
    products.push({ slug, name: product.name, status, productId, images: plannedImages, product, variants, lifecycle, reasons });
  }

  const bySlug = new Map(products.map((planned) => [planned.slug, planned]));
  const groups = catalog.groups.map((group) => {
    const recorded = state.groups[group.key];
    const reasons = [];
    let status = "create";
    let groupId = recorded?.groupId;
    if (recorded?.completed) status = "done";
    else if (recorded?.groupId && remote.groupIds.has(recorded.groupId)) status = "update";
    else if (recorded?.groupId) warnings.push(`group "${group.name.en || group.name.ar}": the state file remembers creating it, but it no longer exists — it will be created again.`);
    else if (recorded?.pending) {
      // Its create's response was lost: adopt the one EMPTY group with exactly this name, if there is exactly one.
      const candidates = (remote.groups ?? []).filter((g) => g.memberCount === 0 && g.name?.en === group.name.en && g.name?.ar === group.name.ar);
      if (candidates.length === 1) {
        status = "update";
        groupId = candidates[0].id;
        warnings.push(`group "${group.name.en || group.name.ar}": created by an earlier run whose response was lost — the empty group with this name is adopted.`);
      } else if (candidates.length > 1) {
        blocking.push(`group "${group.name.en || group.name.ar}": an earlier run may have created it, and ${candidates.length} empty groups have this name — delete the extras in Staff, then run again.`);
      }
    }

    if (status !== "done") {
      for (const member of group.members) {
        const planned = bySlug.get(member.productSlug);
        if (!planned) continue; // already a catalog error
        if (planned.status === "skip") reasons.push(`${member.productSlug} exists but was not created by this importer — grouping it would modify an existing product`);
        const current = remote.productsBySlug.get(member.productSlug)?.group;
        if (current && current.groupId !== groupId) reasons.push(`${member.productSlug} is already in another product group`);
      }
      if (reasons.length > 0) {
        status = "blocked";
        blocking.push(`group "${group.name.en || group.name.ar}" cannot be created: ${reasons.join("; ")}.`);
      }
    }
    return { key: group.key, name: group.name, status, groupId, members: group.members, reasons };
  });

  const count = (list, status) => list.filter((item) => item.status === status).length;
  return {
    blocking,
    warnings,
    products,
    groups,
    unusedFiles: images.unused,
    summary: {
      products: { create: count(products, "create"), resume: count(products, "resume"), done: count(products, "done"), skip: count(products, "skip") },
      uploads: products.flatMap((planned) => planned.images).filter((image) => image.action === "upload").length,
      reusedUploads: products.flatMap((planned) => planned.images).filter((image) => image.action === "reuse").length,
      variants: products.flatMap((planned) => planned.variants).filter((variant) => variant.action === "create").length,
      groups: { create: count(groups, "create"), update: count(groups, "update"), done: count(groups, "done"), blocked: count(groups, "blocked") },
    },
  };
}
