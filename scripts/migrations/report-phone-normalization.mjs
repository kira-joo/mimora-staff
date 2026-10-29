// READ-ONLY report: how many customers' stored phone would change under phone normalisation, and every collision
// (two records that would map to the same canonical phone — the unique index would reject the second).
//
//   MONGODB_URI='mongodb://localhost:27020/?replicaSet=rs0&directConnection=true' MONGODB_DB=store-platform-staff-dev \
//   STORE_PHONE_COUNTRY_CODE=20 node scripts/migrations/report-phone-normalization.mjs
//
// Never writes: it only calls find() with a projection. Guarded to localhost and to databases ending -dev / -test
// or starting store-fixture- (same guard as scripts/fixtures/seed-store.mjs). Phones are masked in the output.
import { MongoClient } from "mongodb";
import { normalizePhone, isValidCountryCallingCode } from "./phone-normalization.mjs";

function guard(env) {
  const problems = [];
  const uri = env.MONGODB_URI ?? "";
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  if (!m) problems.push("MONGODB_URI must be a plain mongodb:// URI");
  else for (const h of m[1].split(",").map((x) => x.replace(/:\d+$/, "").toLowerCase())) if (!["localhost", "127.0.0.1", "::1"].includes(h)) problems.push(`MONGODB_URI host "${h}" is not localhost`);
  const db = env.MONGODB_DB ?? "";
  if (!db) problems.push("MONGODB_DB is required");
  else if (!(db.endsWith("-dev") || db.endsWith("-test") || db.startsWith("store-fixture-"))) problems.push(`MONGODB_DB "${db}" must end in -dev or -test, or start with store-fixture-`);
  const cc = (env.STORE_PHONE_COUNTRY_CODE ?? "").trim();
  if (cc && !isValidCountryCallingCode(cc)) problems.push(`STORE_PHONE_COUNTRY_CODE "${cc}" is not a valid calling code`);
  if (problems.length) throw new Error("Refusing to run (nothing was read or written):\n  - " + problems.join("\n  - "));
}

const mask = (p) => (p.length <= 6 ? "***" : `${p.slice(0, 4)}${"*".repeat(p.length - 6)}${p.slice(-2)}`);

guard(process.env);
const cc = (process.env.STORE_PHONE_COUNTRY_CODE ?? "").trim() || undefined;
const client = new MongoClient(process.env.MONGODB_URI);
try {
  await client.connect();
  const customers = await client.db(process.env.MONGODB_DB).collection("customers").find({}, { projection: { phone: 1 } }).toArray();
  const byCanonical = new Map();
  let changed = 0;
  let invalid = 0;
  for (const c of customers) {
    const stored = typeof c.phone === "string" ? c.phone : "";
    const canonical = normalizePhone(stored, cc);
    if (canonical !== stored) changed++;
    if (!/^\+[1-9]\d{7,14}$/.test(canonical) && !/^\d{5,15}$/.test(canonical)) invalid++;
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, []);
    byCanonical.get(canonical).push({ id: String(c._id), stored });
  }
  const collisions = [...byCanonical].filter(([, rows]) => rows.length > 1);
  console.log(`database: ${process.env.MONGODB_DB}   default country code: ${cc ? `+${cc}` : "(unset — national numbers are NOT converted)"}`);
  console.log(`customers: ${customers.length}`);
  console.log(`would change: ${changed}`);
  console.log(`unchanged: ${customers.length - changed}`);
  console.log(`not a valid phone even after normalisation: ${invalid}`);
  console.log(`collisions (canonical phone shared by 2+ records): ${collisions.length}`);
  for (const [canonical, rows] of collisions) {
    console.log(`  ${mask(canonical)} <- ${rows.map((r) => `${r.id} (${mask(r.stored)})`).join(", ")}`);
  }
  console.log("READ-ONLY: no write was issued.");
} finally {
  await client.close();
}
