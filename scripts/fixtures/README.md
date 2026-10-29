# Fixture stores

Two deliberately different merchants, seeded through the backend's real admin HTTP API, so a storefront can be tested
against more than one shape of store. Only the first owner is written directly to MongoDB (see below).

| | store-a "Hirfa" | store-b "Qahwa & Co" |
|---|---|---|
| Goods / locale | Clothing + hand tools, Cairo | Home + kitchen, Riyadh (ar default, en) |
| Currency | EGP | SAR |
| Brand colours | Dark brand `#9F4E19` | Light, low-contrast `#E9C46A` / `#2A9D8F` (backend must darken) |
| Typography | `default` | `contemporary` |
| Ground | light default, visitor may switch | dark default, dark only, no visitor choice |
| Fulfilment | delivery + 2 pickup points | delivery only, no pickup locations |
| Shipping | by zone, 3 zones | flat 30.00, 2 zones |
| Order minimum | 0 | 150.00 |
| Tax | added, 0% | included, 15% |
| Checkout | guest allowed | sign-in required |
| Cancel / return window | 30 min / 14 days | 10 min / 7 days |
| Payment | COD + WALLET + INSTAPAY (proof) | BANK_TRANSFER + WALLET_TRANSFER, both need proof, no COD |
| Catalogue | 16 products, 7 categories (2 nested), 3 collections, 2 brands, 2 size guides | 7 products, 3 categories, 1 collection, 1 brand, no size guide |
| Product states | multi-axis with colour swatches, sold out, low stock, sale price | one with no images, no axes, single labelled axis (no swatches), sold out, low stock, sale price |
| Promotions | coded WELCOME10 + automatic free delivery | one automatic 12% off over 400 SAR, no code |
| Pages | terms, privacy, returns, shipping, contact, about, care | terms, privacy, returns, delivery |
| Home | hero, tiles, story, rail, editorial band, newest, assurance | hero, rail, tiles, assurance |

Product photos are the shared tool-themed set in `store-platform/public/preview/images` (override with
`FIXTURE_IMAGE_DIR`); store-b reuses them as placeholders.

## Per-deployment settings

Each store's deployment must set these to the store's own country — verified against the fixture's
store profile (its contact number is the merchant's own), and checked at every backend boot
(`phoneCountryMismatch`, logged as `[phone]` when they disagree):

| Store | Contact number | `STORE_PHONE_COUNTRY_CODE` | `STORE_TIMEZONE` |
|---|---|---|---|
| store-a Hirfa | +20 100 555 0142 (Egypt) | `20` | `Africa/Cairo` |
| store-b Qahwa & Co | +966 11 555 0188 (Saudi Arabia) | `966` | `Asia/Riyadh` |

`store-platform/scripts/ci/configuration-proof.sh` sets exactly these per store.

## Store identity

The backend refuses to boot against a database with no store-identity marker, and `seed-store.mjs` deliberately does
**not** adopt: it talks to a backend that is already running, so the database was adopted before that boot, by
whoever started it. Adopt a fixture database once, before its first boot, with the store's own id (`hirfa` for
store-a, `qahwa` for store-b) and set the same `STORE_ID` on the backend:

`MONGODB_DB=store-fixture-b node scripts/admin/adopt-store-identity.mjs --store-id qahwa --confirm-db store-fixture-b`

`store-platform/scripts/ci/configuration-proof.sh` does this before starting the backend. A database dropped and
reseeded needs adopting again. The boot seeds the default roles, so step 1 below needs the adoption first.

## Run locally

**The whole proof in one command** (fixture DB dropped and reseeded, both apps built and served in
production mode on ports 3140/3130, then the storefront's funnel, accessibility and viewport gates) is
the storefront's `scripts/ci/configuration-proof.sh store-a|store-b` — the same script CI runs. Point
`BACKEND_DIR`/`STOREFRONT_DIR` at APFS clones (`cp -c -R`) while dev servers run in the real
directories: `next build` replaces `.next` under them.

To seed by hand instead:

1. Boot a backend against a fixture database. `docs/tasks/ws dev` refuses while another server runs
   from this directory (Next allows one per directory, and a dev start deletes `.next`), so stop the
   dev backend first, or run from a clone. The first boot seeds the permissions and the Owner role,
   which the seeder needs.
2. Seed it:
   `BACKEND_URL=http://localhost:3041 MONGODB_DB=store-fixture-b OWNER_EMAIL=owner@store-fixture-b.local OWNER_PASSWORD=<10+ chars> npm run seed:fixture -- --store store-b`
   `MONGODB_URI` defaults to `mongodb://localhost:27020/?replicaSet=rs0&directConnection=true`.
3. The last line is `FIXTURE_MANIFEST {...}`: currency, ground, guest checkout, delivery/pickup, payment methods and
   product slugs by state, read back from the public `/api/storefront/**` API, not from the fixture. Set
   `FIXTURE_MANIFEST_OUT=<path>` to also write it as JSON. Every slug list is an array.

Seeding is idempotent: a second run updates in place, creates nothing and leaves the storefront content unchanged.
Stock is re-set to the fixture values on each run.

Without a server: `node scripts/fixtures/seed-store.mjs --check` validates both fixtures structurally;
add `--self-test` to prove the check fails on deliberately broken in-memory copies. `--no-image-files` skips the
image-file existence check, and says so, for a job without the sibling `store-platform` checkout (this repo's CI);
seeding still reads every image, so store-platform's configuration proof covers it.

## Safety guards

All fail before any write: `BACKEND_URL` and every `MONGODB_URI` host must be `localhost`/`127.0.0.1`/`::1` (single-label
service names such as `mongodb` only when `CI=true`); `mongodb+srv` is refused; `MONGODB_DB` must end in `-dev` or
`-test` or start with `store-fixture-`; `OWNER_PASSWORD` must be at least 10 characters; an unknown `--store` lists the
valid ones; the fixture must pass its own structural check. Any non-2xx response aborts with method, path, status and body
(login and accept-invite never echo their request body). The session cookie jar lives in the OS temp dir, mode 0600,
keyed by database name; refresh tokens rotate, so it is rewritten after every call.

## Owner bootstrap

No code path creates a first staff user. If no `staffusers` row exists for `OWNER_EMAIL`, the seeder inserts one with the
`Owner` role (looked up in `roles`), no password, and the SHA-256 of a one-time token as `passwordResetTokenHash`
(expires in 1 hour), exactly the state an invitation leaves. It then calls the real
`POST /api/admin/auth/accept-invite` to set the password, and logs in with `POST /api/admin/auth/login`. If the Owner role is
missing the backend has not booted against that database yet, and the seeder says so and stops. An existing owner with a
password is left untouched.
