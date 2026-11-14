import fs from "node:fs";
import path from "node:path";
import { parseCatalog } from "./catalog.mjs";
import { inspectImages } from "./images.mjs";
import { buildPlan, productBody, variantBody } from "./plan.mjs";
import { ENDPOINTS } from "./staff-client.mjs";
import { acquireLock, loadState } from "./state.mjs";

export const CATALOG_FILE = "catalog.json";
export const REPORTS_DIR = "import-reports";

/** What the store holds now — read through the admin API only. */
export async function loadRemote(client) {
  const [categories, collections, products, variants, groups] = await Promise.all([
    client.listAll(ENDPOINTS.categories),
    client.listAll(ENDPOINTS.collections),
    client.listAll(ENDPOINTS.products),
    client.listAll(ENDPOINTS.variants),
    client.listAll(ENDPOINTS.productGroups),
  ]);
  return {
    categories: new Set(categories.map((category) => String(category._id))),
    collections: new Set(collections.map((collection) => String(collection._id))),
    productsBySlug: new Map(products.map((product) => [product.slug, { id: String(product._id), slug: product.slug, lifecycle: product.lifecycle, group: product.group }])),
    skuOwner: new Map(variants.map((variant) => [variant.sku, String(variant.productId)])),
    groupIds: new Set(groups.map((group) => String(group._id))),
    groups: groups.map((group) => ({ id: String(group._id), name: group.name, memberCount: group.memberCount })),
  };
}

/**
 * One importer run. `mode: "dry-run"` reads and plans only — no upload, no write to the store, no change to the
 * state file. `mode: "execute"` refuses to start while anything is blocking, then runs the plan one step at a time,
 * saving the state file after every successful step and stopping at the first failure.
 *
 * @param {{ dir: string, client: ReturnType<typeof import("./staff-client.mjs").createStaffClient>, mode: "dry-run" | "execute", log?: (line: string) => void, now?: () => Date }} options
 */
export async function runImport({ dir, client, mode, log = () => undefined, now = () => new Date() }) {
  const report = { mode, target: client.origin, dir, startedAt: now().toISOString(), outcome: "pending", steps: [], verification: [] };
  const catalogPath = path.join(dir, CATALOG_FILE);
  if (!fs.existsSync(catalogPath)) {
    report.outcome = "blocked";
    report.plan = { blocking: [`${catalogPath} not found.`], warnings: [] };
    return finish(report, now);
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (error) {
    report.outcome = "blocked";
    report.plan = { blocking: [`catalog.json is not valid JSON: ${error.message}`], warnings: [] };
    return finish(report, now);
  }
  const catalog = parseCatalog(json);
  const images = inspectImages(dir, catalog.products.flatMap((entry) => entry.images));
  let state;
  try {
    state = loadState(dir, client.origin);
  } catch (error) {
    report.outcome = "blocked";
    report.plan = { blocking: [error.message], warnings: [] };
    return finish(report, now);
  }
  let releaseLock = () => undefined;
  if (mode === "execute") {
    try {
      releaseLock = acquireLock(dir);
    } catch (error) {
      report.outcome = "blocked";
      report.plan = { blocking: [error.message], warnings: [] };
      return finish(report, now);
    }
  }
  try {
    return await importWith({ dir, client, mode, log, now, report, catalog, images, state });
  } finally {
    releaseLock();
  }
}

async function importWith({ client, mode, log, now, report, catalog, images, state }) {
  const remote = await loadRemote(client);
  // A product whose create response was lost is recognised by the image that run uploaded for it — read that image.
  remote.imagesBySlug = new Map();
  for (const [slug, record] of Object.entries(state.target.products)) {
    const existing = remote.productsBySlug.get(slug);
    if (existing && !record.productId && record.pending?.imagePublicId) {
      const product = await client.get(ENDPOINTS.product(existing.id));
      remote.imagesBySlug.set(slug, (product.images ?? []).map((image) => image.publicId));
    }
  }
  const plan = buildPlan({ catalog, images, remote, state: state.target });
  report.plan = plan;

  if (mode === "dry-run") {
    report.outcome = plan.blocking.length > 0 ? "blocked" : "ready";
    return finish(report, now);
  }
  if (plan.blocking.length > 0) {
    report.outcome = "blocked";
    log("Not starting: fix the blocking problems first. Nothing was uploaded or created.");
    return finish(report, now);
  }

  const step = async (kind, subject, action) => {
    const entry = { kind, subject, ok: false };
    report.steps.push(entry);
    try {
      const detail = await action();
      Object.assign(entry, { ok: true, ...(detail ?? {}) });
      log(`  ✓ ${kind} ${subject}${detail?.note ? ` — ${detail.note}` : ""}`);
      return true;
    } catch (error) {
      Object.assign(entry, { error: error.message, status: error.status });
      log(`  ✗ ${kind} ${subject}: ${error.message}`);
      return false;
    }
  };

  let failed = false;
  for (const planned of plan.products) {
    if (failed || planned.status === "done" || planned.status === "skip") continue;
    const record = (state.target.products[planned.slug] ??= { productId: undefined, variants: {}, lifecycleSet: false, completed: false });
    if (planned.status === "resume") record.productId = planned.productId;

    if (!record.productId) {
      const assets = [];
      for (const image of planned.images) {
        const ok = await step("image", `${planned.slug} ← ${image.filename}`, async () => {
          const remembered = state.target.images[image.sha256]?.asset;
          if (remembered && (await client.assetReachable(remembered))) {
            assets.push(remembered);
            return { note: "re-used the earlier upload", publicId: remembered.publicId };
          }
          const file = images.files.get(image.filename);
          const asset = await client.uploadProductImage(fs.readFileSync(file.path), image.filename, file.mime);
          state.target.images[image.sha256] = { filename: image.filename, asset, uploadedAt: now().toISOString() };
          state.save();
          assets.push(asset);
          return { note: remembered ? "uploaded again (the earlier upload is gone)" : "uploaded", publicId: asset.publicId };
        });
        if (!ok) failed = true;
        if (failed) break;
      }
      if (failed) break;
      const ok = await step("product", planned.slug, async () => {
        // Intent first: if the response is lost, the next run recognises this product by the image it carries.
        record.pending = { imagePublicId: assets[0]?.publicId, startedAt: now().toISOString() };
        state.save();
        const created = await client.post(`${ENDPOINTS.products}?onSlugTaken=reject`, productBody(planned.product, assets));
        if (created.slug !== planned.slug) throw new Error(`the server saved it as "${created.slug}" — stop and review`);
        record.productId = String(created._id);
        delete record.pending;
        state.save();
        return { note: "created as a draft", productId: record.productId };
      });
      if (!ok) {
        failed = true;
        break;
      }
    }

    for (const variant of planned.variants) {
      if (variant.action === "exists" || record.variants[variant.sku]) continue;
      const ok = await step("variant", `${planned.slug} / ${variant.sku}`, async () => {
        const created = await client.post(ENDPOINTS.variants, variantBody(record.productId, variant.body));
        record.variants[variant.sku] = String(created._id);
        state.save();
        return { variantId: record.variants[variant.sku] };
      });
      if (!ok) {
        failed = true;
        break;
      }
    }
    if (failed) break;

    if (planned.lifecycle.action === "set" && !record.lifecycleSet) {
      const ok = await step("lifecycle", `${planned.slug} → ${planned.lifecycle.target}`, async () => {
        await client.put(ENDPOINTS.productLifecycle(record.productId), { lifecycle: planned.lifecycle.target });
        record.lifecycleSet = true;
        state.save();
      });
      if (!ok) {
        failed = true;
        break;
      }
    }
    record.completed = true;
    state.save();
  }

  if (!failed) {
    for (const group of plan.groups) {
      if (group.status === "done" || group.status === "blocked") continue;
      const incomplete = group.members.filter((member) => !state.target.products[member.productSlug]?.completed);
      if (incomplete.length > 0) {
        report.steps.push({ kind: "group", subject: group.name.en, ok: false, error: `not created: members not complete (${incomplete.map((m) => m.productSlug).join(", ")})` });
        failed = true;
        break;
      }
      const record = (state.target.groups[group.key] ??= { groupId: undefined, completed: false });
      if (group.status === "create") record.groupId = undefined;
      if (group.status === "update" && !record.groupId) {
        record.groupId = group.groupId; // adopted: its create's response was lost
        delete record.pending;
        state.save();
      }
      if (!record.groupId) {
        const ok = await step("group", `create "${group.name.en || group.name.ar}"`, async () => {
          record.pending = { startedAt: now().toISOString() };
          state.save();
          const created = await client.post(ENDPOINTS.productGroups, { name: group.name });
          record.groupId = String(created._id);
          delete record.pending;
          state.save();
          return { groupId: record.groupId };
        });
        if (!ok) {
          failed = true;
          break;
        }
      }
      const ok = await step("group members", `"${group.name.en || group.name.ar}" (${group.members.length}, storefront order)`, async () => {
        const detail = await client.get(ENDPOINTS.productGroup(record.groupId));
        const members = group.members.map((member) => ({ productId: state.target.products[member.productSlug].productId, label: member.label }));
        await client.put(ENDPOINTS.productGroupMembers(record.groupId), { expectedRevision: detail.revision, members });
        record.completed = true;
        state.save();
      });
      if (!ok) {
        failed = true;
        break;
      }
    }
  }

  report.outcome = failed ? "failed" : "completed";
  if (!failed) report.verification = await verify({ client, plan, state: state.target, images });
  if (!failed && report.verification.some((check) => !check.ok)) report.outcome = "completed-with-verification-failures";
  return finish(report, now);
}

/** Re-reads every product and group this run touched and checks it is exactly what the catalog asked for. */
async function verify({ client, plan, state, images }) {
  const checks = [];
  const check = (subject, ok, detail) => checks.push({ subject, ok, detail });
  for (const planned of plan.products) {
    if (planned.status === "skip" || planned.status === "done") continue;
    const record = state.products[planned.slug];
    const product = await client.get(ENDPOINTS.product(record.productId));
    const expectedImages = planned.images.map((image) => state.images[images.files.get(image.filename)?.sha256]?.asset?.publicId);
    const actualImages = (product.images ?? []).map((image) => image.publicId);
    check(`${planned.slug}: slug, category, lifecycle`, product.slug === planned.slug && String(product.categoryId) === String(planned.product.categoryId) && product.lifecycle === planned.lifecycle.target, `${product.lifecycle}`);
    check(`${planned.slug}: collections`, JSON.stringify([...(product.collectionIds ?? [])].map(String).sort()) === JSON.stringify([...(planned.product.collectionIds ?? [])].map(String).sort()));
    if (planned.status === "create") check(`${planned.slug}: images are this product's file(s), in order`, JSON.stringify(actualImages) === JSON.stringify(expectedImages), actualImages.join(", "));
    const variants = await client.listAll(`${ENDPOINTS.variants}?productId=${encodeURIComponent(record.productId)}`);
    for (const expected of planned.variants) {
      const found = variants.find((variant) => variant.sku === expected.body.sku);
      check(`${planned.slug} / ${expected.body.sku}: price and stock`, Boolean(found) && Number(found.price) === Number(expected.body.price) && found.stock === expected.body.stock, found ? `${found.price} × ${found.stock}` : "missing");
    }
  }
  for (const group of plan.groups) {
    if (group.status === "done" || group.status === "blocked") continue;
    const record = state.groups[group.key];
    const detail = await client.get(ENDPOINTS.productGroup(record.groupId));
    const actual = detail.members.map((member) => `${member.slug}:${member.label.en}/${member.label.ar}`);
    const expected = group.members.map((member) => `${member.productSlug}:${member.label.en}/${member.label.ar}`);
    check(`group "${group.name.en || group.name.ar}": members, order and labels`, JSON.stringify(actual) === JSON.stringify(expected), actual.join(" | "));
  }
  return checks;
}

function finish(report, now) {
  report.finishedAt = now().toISOString();
  const folder = path.join(report.dir, REPORTS_DIR);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${report.startedAt.replace(/[:.]/g, "-")}-${report.mode}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  report.file = file;
  return report;
}
