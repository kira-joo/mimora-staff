#!/usr/bin/env node
// Adopt a database for one store — see scripts/admin/README.md before running this against production.
//
//   MONGODB_URI=… MONGODB_DB=… node scripts/admin/adopt-store-identity.mjs --store-id mimora --confirm-db <MONGODB_DB> [--dry-run]
//
// Writes the database's store-identity marker once, and only if there is none. Always prints what is in the database
// first (store name, currency, product/order/customer counts) so you can see whose data you are about to claim.
// Exit 0: adopted, or already adopted as the same store. Exit 1: refused (`refused: <reason>`), nothing written.
import { createRequire } from "node:module";
import { adoptStoreIdentity, assertConfirmed, assertStoreId, parseArgs, preflight, resolveTarget, StoreIdentityRefusal } from "./store-identity-core.mjs";
import { BootstrapRefusal } from "./bootstrap-owner-core.mjs";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");

try {
  const args = parseArgs(process.argv.slice(2));
  const storeId = assertStoreId(args["store-id"]);
  const target = resolveTarget(process.env.MONGODB_URI, process.env.MONGODB_DB);
  assertConfirmed(target.dbName, args["confirm-db"]);
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db(target.dbName);
    const seen = await preflight(db);
    const name = seen.profile ? `${seen.profile.nameEn ?? "(no English name)"} / ${seen.profile.nameAr ?? "(no Arabic name)"}, currency ${seen.profile.currency ?? "(none)"}` : "none (no store profile yet)";
    console.log(`Database:      ${target.dbName}`);
    console.log(`Hosts:         ${target.hosts.join(", ")}`);
    console.log(`Marker:        ${seen.marker ? `store '${seen.marker.storeId}' (adopted ${seen.marker.adoptedAt?.toISOString?.() ?? "at an unknown time"})` : "none"}`);
    console.log(`Store profile: ${name}`);
    console.log(`Data:          ${seen.counts.products} products, ${seen.counts.orders} orders, ${seen.counts.customers} customers`);
    console.log(`Adopting as:   '${storeId}'${args["dry-run"] === true ? " (dry run)" : ""}\n`);

    const result = await adoptStoreIdentity(db, { storeId, confirmDb: args["confirm-db"], dryRun: args["dry-run"] === true });
    if (result.action === "would-adopt") console.log(`dry run: would adopt ${target.dbName} as store '${storeId}'. Nothing was written.`);
    else if (result.action === "already-adopted") console.log(`${target.dbName} is already adopted as store '${storeId}'. Nothing changed.`);
    else console.log(`Adopted ${target.dbName} as store '${storeId}'. Set STORE_ID=${storeId} on this backend and on the storefront.`);
  } finally {
    await client.close();
  }
} catch (error) {
  console.error(error instanceof StoreIdentityRefusal || error instanceof BootstrapRefusal ? `refused: ${error.message}` : error);
  process.exit(1);
}
