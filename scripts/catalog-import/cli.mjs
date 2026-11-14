#!/usr/bin/env node
/**
 * Mimora catalog importer — run from the mimora-staff folder:
 *
 *   npm run catalog:import -- --dry-run  --target https://mimora-staff.vercel.app
 *   npm run catalog:import -- --execute  --target https://mimora-staff.vercel.app --confirm-target mimora-staff.vercel.app
 *
 * Reads scripts/catalog-import/product-import/catalog.json and its images (or --dir <folder>), wherever it is run from.
 * See scripts/catalog-import/README.md.
 */
import readline from "node:readline";
import { DEFAULT_IMPORT_DIR, resolveImportDir } from "./paths.mjs";
import { createStaffClient } from "./staff-client.mjs";
import { runImport } from "./run.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseArgs(argv) {
  const args = { dryRun: false, execute: false, dir: DEFAULT_IMPORT_DIR, target: process.env.MIMORA_STAFF_URL, confirmTarget: undefined, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value.`);
      i += 1;
      return next;
    };
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--dir") args.dir = resolveImportDir(value());
    else if (arg === "--target") args.target = value();
    else if (arg === "--confirm-target") args.confirmTarget = value();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown option ${arg}. Run with --help.`);
  }
  return args;
}

const HELP = `Mimora catalog importer (run from mimora-staff/)

  npm run catalog:import -- --dry-run --target <staff URL>
  npm run catalog:import -- --execute --target <staff URL> [--confirm-target <host>]

  --dry-run           Validate and show everything that would happen. Uploads and creates nothing (signing in
                      records a staff session, exactly as logging into the console does).
  --execute           Do it. Refuses to start while anything is blocking.
  --target <url>      The staff app, e.g. https://mimora-staff.vercel.app or http://localhost:3012
                      (or set MIMORA_STAFF_URL).
  --confirm-target    Required with --execute when the target is not localhost: type its host name.
  --dir <folder>      Import folder (default: ${DEFAULT_IMPORT_DIR}).
                      A relative folder is taken from scripts/catalog-import/, not from where you run the command.

  Sign-in: MIMORA_STAFF_EMAIL and MIMORA_STAFF_PASSWORD, or you are asked (the password is not echoed).
  The account needs Product create/update, Variant create, ProductGroup create/update, and Category/Collection read.`;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (chunk) => {
        if (chunk.includes(question)) process.stdout.write(chunk);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function printPlan(plan, mode) {
  const line = (text = "") => console.log(text);
  line(`\nProducts (${plan.products.length}):`);
  for (const p of plan.products) {
    const images = p.images.map((image) => `${image.filename}${image.width ? ` ${image.width}×${image.height}` : ""}${image.action === "upload" ? " (upload)" : image.action === "reuse" ? " (re-use earlier upload)" : ""}`).join(", ");
    const variants = p.variants.map((variant) => `${variant.sku} ${variant.body.price}×${variant.body.stock}${variant.action === "exists" ? " (exists)" : variant.action === "none" ? "" : ""}`).join(", ");
    line(`  [${p.status.toUpperCase().padEnd(6)}] ${p.slug} — ${p.name?.en ?? ""}`);
    if (p.status === "create" || p.status === "resume") {
      line(`             image: ${images}`);
      line(`             variants: ${variants}`);
      line(`             lifecycle: ${p.lifecycle.target}${p.lifecycle.action === "set" ? " (created as draft, set after its variants)" : ""}`);
    }
  }
  if (plan.groups.length > 0) {
    line(`\nProduct groups (${plan.groups.length}):`);
    for (const g of plan.groups) {
      line(`  [${g.status.toUpperCase().padEnd(7)}] ${g.name.en} / ${g.name.ar}`);
      g.members.forEach((m, i) => line(`             ${i + 1}. ${m.productSlug} — ${m.label.en} / ${m.label.ar}`));
    }
  }
  if (plan.unusedFiles?.length) line(`\nImages in the folder that catalog.json does not use (ignored): ${plan.unusedFiles.join(", ")}`);
  if (plan.warnings.length) {
    line(`\nWarnings (${plan.warnings.length}):`);
    plan.warnings.forEach((w) => line(`  ! ${w}`));
  }
  if (plan.blocking.length) {
    line(`\nBLOCKING — ${mode === "execute" ? "nothing was written" : "--execute will refuse to start"} until these are fixed (${plan.blocking.length}):`);
    plan.blocking.forEach((b) => line(`  ✗ ${b}`));
  }
  const s = plan.summary;
  if (s) line(`\nSummary: products create ${s.products.create}, resume ${s.products.resume}, already done ${s.products.done}, skipped ${s.products.skip}; image uploads ${s.uploads} (+${s.reusedUploads} re-used); variants ${s.variants}; groups create ${s.groups.create}, update ${s.groups.update}, done ${s.groups.done}, blocked ${s.groups.blocked}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.dryRun === args.execute) throw new Error("Choose exactly one of --dry-run or --execute. Run with --help.");
  if (!args.target) throw new Error("Say which store: --target <staff URL> (or set MIMORA_STAFF_URL).");
  const host = new URL(args.target).host;
  const local = LOCAL_HOSTS.has(new URL(args.target).hostname);
  if (args.execute && !local && args.confirmTarget !== host) throw new Error(`--execute against ${host} needs --confirm-target ${host} (typed, so a production run is never an accident).`);

  console.log(`Catalog importer — ${args.execute ? "EXECUTE" : "DRY RUN (no upload, no product, variant or group is created)"}`);
  console.log(`  store:  ${new URL(args.target).origin}`);
  console.log(`  folder: ${args.dir}`);

  const email = process.env.MIMORA_STAFF_EMAIL || (await ask("Staff email: "));
  const password = process.env.MIMORA_STAFF_PASSWORD || (await ask("Staff password: ", { hidden: true }));
  const client = createStaffClient({ target: args.target });
  await client.login(email, password);
  console.log("  signed in.");

  const report = await runImport({ dir: args.dir, client, mode: args.execute ? "execute" : "dry-run", log: (l) => console.log(l) });
  if (report.plan) printPlan(report.plan, report.mode);
  if (report.verification?.length) {
    const failed = report.verification.filter((c) => !c.ok);
    console.log(`\nVerification: ${report.verification.length - failed.length}/${report.verification.length} checks passed.`);
    failed.forEach((c) => console.log(`  ✗ ${c.subject}${c.detail ? ` — ${c.detail}` : ""}`));
  }
  const failedStep = report.steps.find((s) => !s.ok);
  if (failedStep) console.log(`\nSTOPPED at: ${failedStep.kind} ${failedStep.subject} — ${failedStep.error}\nEverything before it is saved; fix the cause and run --execute again to resume.`);
  console.log(`\nOutcome: ${report.outcome}\nReport:  ${report.file}`);
  process.exitCode = ["ready", "completed"].includes(report.outcome) ? 0 : 1;
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
