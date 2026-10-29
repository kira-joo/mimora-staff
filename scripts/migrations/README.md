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
