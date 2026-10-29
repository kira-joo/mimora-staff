#!/usr/bin/env node
// Create the store's first Owner — see scripts/admin/README.md before running this against production.
//
//   MONGODB_URI=… MONGODB_DB=… node scripts/admin/bootstrap-owner.mjs --email owner@example.com [--name "Owner Name"]
//       [--dry-run] [--reissue] [--confirm-production=<MONGODB_DB>] [--backoffice-url=https://admin.example.com]
//
// Prints a single-use invitation code (valid one hour) to THIS terminal only. The Owner enters it on the
// backoffice's /accept-invite page and chooses their own password there.
import { createRequire } from "node:module";
import { assertConfirmed, bootstrapOwner, BootstrapRefusal, describeTarget, parseArgs } from "./bootstrap-owner-core.mjs";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");

try {
  const args = parseArgs(process.argv.slice(2));
  const target = describeTarget(process.env.MONGODB_URI, process.env.MONGODB_DB);
  assertConfirmed(target, args["confirm-production"]);
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const result = await bootstrapOwner(client, client.db(target.dbName), {
      email: args.email,
      name: typeof args.name === "string" ? args.name : undefined,
      reissue: args.reissue === true,
      dryRun: args["dry-run"] === true,
    });
    if (result.action === "would-create") {
      console.log(`dry run: would create Owner ${result.email} in ${target.dbName} (${target.local ? "local" : "PRODUCTION"}). Nothing was written.`);
    } else {
      const page = typeof args["backoffice-url"] === "string" ? `${args["backoffice-url"].replace(/\/$/, "")}/accept-invite` : "the backoffice's /accept-invite page";
      console.log(`${result.action === "created" ? "Created" : "Re-issued the code for"} Owner ${result.email} in ${target.dbName}.`);
      console.log(`Give the Owner this single-use code (expires ${result.expiresAt.toISOString()}), to enter on ${page}:`);
      console.log(`\n    ${result.token}\n`);
      console.log("It is shown only here and is not stored in readable form. If it expires, run again with --reissue.");
    }
  } finally {
    await client.close();
  }
} catch (error) {
  console.error(error instanceof BootstrapRefusal ? `refused: ${error.message}` : error);
  process.exit(1);
}
