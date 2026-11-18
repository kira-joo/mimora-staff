# Migrations

## Phone normalisation (proposed — NOT executed)

New customer phones are stored canonical (`src/server/core/phone/normalize-phone.ts`): Latin digits, separators
stripped, `00` becomes `+`, and — only when `STORE_PHONE_COUNTRY_CODE` is set — a trunk-`0` national number becomes
`+<cc><number>`. Records written before this change keep whatever was typed (`01012345678`, `+201012345678`, Arabic
digits…). **No data was changed.** Login, forgot-password and signup's duplicate check match both the canonical and the
derivable legacy forms, so nobody is locked out; the cost is that two stored forms of one number can coexist until the
data is migrated.

### Report (read-only)

```bash
MONGODB_URI='mongodb://localhost:27020/?replicaSet=rs0&directConnection=true' MONGODB_DB=store-platform-staff-dev \
STORE_PHONE_COUNTRY_CODE=20 node scripts/migrations/report-phone-normalization.mjs
```

Guarded to localhost and databases ending `-dev`/`-test` or starting `store-fixture-`. Only `find()` with a projection;
phones are masked in the output. It lists how many customers would change and every **collision** (two records mapping
to the same canonical phone).

### Risks

1. **Collisions.** The `phone` unique index rejects the second record. Two accounts for one real person (typed
   `01012345678` once and `+201012345678` once) must be merged by a human decision — orders, addresses, carts and
   wishlists reference `customerId`. Never auto-pick a winner.
2. **Wrong country.** `STORE_PHONE_COUNTRY_CODE` must be the deployment's real country. A wrong value would rewrite
   every national number to the wrong E.164 number and break login for all of them (the legacy fallback does not help
   once the stored value is rewritten to a number that differs from what customers type).
3. **Non-customer collections** hold phones too (addresses, order contact/address snapshots, cart fulfilment drafts).
   Order snapshots must NOT be rewritten — they record what the customer agreed to. Addresses and carts are
   convenience data and can be normalised or left; nothing looks them up by phone.
4. **Unique index and concurrent writes.** Run with the shop surface quiet (or in a maintenance window) so a signup
   cannot race the update.

### Proposed migration (to be run only on explicit instruction)

1. Run the report against a restored copy of production with the real country code. Resolve every collision by hand.
2. Take a backup (`mongodump` of `customers`).
3. For each customer whose canonical form differs and does not collide: `updateOne({ _id }, { $set: { phone: canonical } })`
   in batches, logging `_id` and old value to a file so it is reversible. Do not touch order snapshots.
4. Re-run the report: it must show `would change: 0` and `collisions: 0`.
5. Optionally remove the legacy-variant fallback in `find-customer-by-phone.ts` once the report is clean in every
   environment (keep it cheap: it is one `$in` query).

## Copy store data to a new database (`copy-store-to-target.mjs`)

Copies the data a new deployment needs — catalog, settings, content — from one database to another, byte-for-byte
(every `_id` and BSON type kept). It never overwrites: a document already in the target is compared, and any conflict
stops the run before anything is written; the writes run in one transaction, so a run lands completely or not at all,
and a repeat changes nothing. It does not copy orders, customers, carts, sessions, staff or permissions (those are
created by the adoption script, the boot and the Owner bootstrap). The target's credentials are read from a file you
pass with `--target-env=<file>` (keep it out of git — `.env*` is ignored) and are never printed.

```bash
node scripts/migrations/copy-store-to-target.mjs --target-env=.env.target.local --dry-run
node scripts/migrations/copy-store-to-target.mjs --target-env=.env.target.local --confirm-target-db=<target db>
node scripts/migrations/copy-store-to-target.mjs --target-env=.env.target.local --verify
```

## Money storage: Decimal128 → BSON Double (`money-to-double.mjs`)

Since 2026-11-18 Mimora stores money as BSON Double (`src/server/core/money/money-double-field.ts`; calculation stays
`Decimal`, the wire stays a decimal string). The application reads both `Decimal128` and Double, so existing records keep
working before, during and after this migration. It converts **only** the 25 money fields listed in the script (a test
keeps that list equal to the schemas), and reports — never touches — a `Decimal128` found anywhere else.

**Dry run is the default and is read-only.** It is also the production audit: per collection the document count; per
money field the count by BSON type (decimal, double, int, long, string, null, missing, …), every value that will NOT be
converted with its `_id` and the reason (string, object, negative, more than two decimals, non-finite, too large), an
exact fingerprint (count and decimal sum), and any `Decimal128` outside the money fields.

```bash
# 1. Audit + plan (writes nothing). The env file holds MONGODB_URI and MONGODB_DB; it is read in-process, never printed.
node scripts/migrations/money-to-double.mjs --env-file=.env.atlas.local

# 2. Back up the eight affected collections (and take an Atlas snapshot if the plan has one).
mongodump --uri="$MONGODB_URI" --db="$MONGODB_DB" --out=backup-money-$(date +%Y%m%d-%H%M) \
  --collection=variants   # repeat --collection for: products deliveryzones fulfilmentsettings orders orderlines returns promotions
#    (mongodump takes one --collection per run; run it once per collection, or omit --collection to dump the database.)

# 3. Execute — requires the database name typed exactly. Logs every change to scripts/migrations/money-to-double-logs/.
node scripts/migrations/money-to-double.mjs --env-file=.env.atlas.local --execute --confirm-db=<MONGODB_DB>

# 4. Verify (read-only): no convertible Decimal128 left, every logged change still in place and amount-identical.
node scripts/migrations/money-to-double.mjs --env-file=.env.atlas.local --verify --log=scripts/migrations/money-to-double-logs/<file>.jsonl
```

An execute fingerprints every field before and after (count and exact sum must be identical) and verifies its own
change log; either failing exits non-zero. Each update matches on the value it read, so a document the shop changes
mid-run is skipped, not overwritten — run again and it is picked up. A second run converts nothing. Writes go through
the raw driver: `updatedAt` is not bumped and nothing else in a document changes.

**Rollback.** Preferred: `--reverse` (dry run first, then `--reverse --execute --confirm-db=<db>`) converts every Double
money value back to `Decimal128` at two decimals — lossless, since every value is two-decimal. If the *code* must also be
rolled back to a version that only reads `Decimal128`: run `--reverse --execute` while the new code is still serving
(it reads both), deploy the old code, then run `--reverse --execute` once more to catch anything written in between.
Last resort: `mongorestore` from the step-2 backup.

`copy-store-to-target.mjs` compares documents type-sensitively; copy only between databases on the same side of this
migration.
