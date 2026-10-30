# Fixture stores

**One fictional CI gift shop in two settings profiles**, seeded through the backend's real admin HTTP API, so a storefront can be
tested against more than one state of the settings the owner can switch. Only the first owner is written directly to MongoDB (see
below). The shop is **Sukkar & Qamar**, an invented Cairo gift shop (`stores/ci-gift-shop.mjs`): it is test data, never Mimora's
catalog, and it is seeded only into throwaway `store-fixture-*` databases. There is no second merchant: both profiles share one
identity (name, contact, EGP) and one catalogue, and differ only in settings and content.

| | `ci-default` | `ci-alternate` |
|---|---|---|
| Identity / currency | Sukkar & Qamar, EGP | the same |
| Brand colours | Dark brand `#9F4E19` | Light, low-contrast `#E9C46A` / `#2A9D8F` (backend must darken) |
| Typography | `default` | `default` (the template's `contemporary` pairing is not exercised: it breaks the CLS budget on the home hero at ar/375) |
| Ground | light default, visitor may switch | dark default, no visitor choice |
| Fulfilment | delivery + 2 pickup points | delivery only, no pickup locations |
| Shipping | by zone, 3 zones | flat 60.00, 2 zones (Cairo, Alexandria) |
| Order minimum | 0 | 150.00 |
| Tax | added, 0% | included, 14% (Egypt's VAT) |
| Checkout | guest allowed | sign-in required (the server refuses a guest order) |
| Cancel / return window | 30 min / 14 days | 10 min / 7 days |
| Payment | COD + WALLET + INSTAPAY (proof) | BANK_TRANSFER + WALLET_TRANSFER, both need proof, no COD |
| Promotions | coded WELCOME10 + automatic free delivery | one automatic 12% off over 4,000 EGP, no code |
| Pages | terms, privacy, returns, shipping, contact, about, care | terms, privacy, returns, delivery |
| Home | hero, tiles, story, rail, editorial band, newest, assurance | hero, rail, tiles, assurance |

Shared by both: 17 products (57 variants) in 7 categories (2 nested), 3 collections, 2 brands and 2 size guides. Product states:
multi-axis with colour swatches, 6 sold-out variants (one product sold out entirely), low stock, sale price, per-variant
gallery overrides, axis-less single-variant products, and one product (`mug-gift-set`) with no images.

A third fixture, **mimora** (`--store mimora`), is not a test merchant but a SAMPLE-content store for a local owner review of the
homepage redesign: a gift shop, EGP, COD only, one Cairo zone, 4 placeholder products (stock 10), 4 categories, 7 collections and the five
home sections of the approved reference. It has no pages (the console's "Create legal page drafts" is run instead; it never publishes), no
brands, no promotions and no operating hours. Its images are the owner's files under `mimora-client/public/brand/mimora/`, referenced as
`brand/...` paths (see "Image references"), so the seeder stores `secureUrl: /brand/mimora/...` with the file's real extension and size.

The CI fixture shop's product photos are the gift-themed set in this repo's `scripts/fixtures/images` (override with
`FIXTURE_IMAGE_DIR`): downscaled, cropped and flipped copies of the owner's own photos, used as placeholders for QA only.

## Per-deployment settings

A deployment must set these to the store's own country — verified against the fixture's store profile (its contact number is
the merchant's own), and checked at every backend boot (`phoneCountryMismatch`, logged as `[phone]` when they disagree):

| Fixture | Contact number | `STORE_PHONE_COUNTRY_CODE` | `STORE_TIMEZONE` |
|---|---|---|---|
| CI fixture shop (both profiles) | +20 100 555 0142 (Egypt) | `20` | `Africa/Cairo` |

`mimora-client/scripts/ci/configuration-proof.sh` sets exactly these.

## Store identity

The backend refuses to boot against a database with no store-identity marker, and `seed-store.mjs` deliberately does
**not** adopt: it talks to a backend that is already running, so the database was adopted before that boot, by
whoever started it. Adopt a fixture database once, before its first boot, with the profile's own id (`ci-default` or
`ci-alternate`; `mimora` for the mimora sample store) and set the same `STORE_ID` on the backend:

`MONGODB_DB=store-fixture-ci-alternate node scripts/admin/adopt-store-identity.mjs --store-id ci-alternate --confirm-db store-fixture-ci-alternate`

`mimora-client/scripts/ci/configuration-proof.sh` does this before starting the backend. A database dropped and
reseeded needs adopting again. The boot seeds the default roles, so step 1 below needs the adoption first.

## Run locally

**The whole proof in one command** (fixture DB dropped and reseeded, both apps built and served in
production mode on ports 3140/3130, then the storefront's funnel, accessibility and viewport gates) is
`mimora-client`'s `scripts/ci/configuration-proof.sh ci-default|ci-alternate` — the same script CI runs. Point
`BACKEND_DIR`/`STOREFRONT_DIR` at APFS clones (`cp -c -R`) while dev servers run in the real
directories: `next build` replaces `.next` under them.

To seed by hand instead:

1. Boot a backend against a fixture database. `docs/tasks/ws dev` refuses while another server runs
   from this directory (Next allows one per directory, and a dev start deletes `.next`), so stop the
   dev backend first, or run from a clone. The first boot seeds the permissions and the Owner role,
   which the seeder needs.
2. Seed it:
   `BACKEND_URL=http://localhost:3041 MONGODB_DB=store-fixture-ci-alternate OWNER_EMAIL=owner@store-fixture-ci-alternate.local OWNER_PASSWORD=<10+ chars> npm run seed:fixture -- --store ci-alternate`
   `MONGODB_URI` defaults to `mongodb://localhost:27020/?replicaSet=rs0&directConnection=true`.
3. The last line is `FIXTURE_MANIFEST {...}`: currency, ground, guest checkout, delivery/pickup, payment methods and
   product slugs by state, read back from the public `/api/storefront/**` API, not from the fixture. Set
   `FIXTURE_MANIFEST_OUT=<path>` to also write it as JSON. Every slug list is an array.

Seeding is idempotent: a second run updates in place, creates nothing and leaves the storefront content unchanged.
Stock is re-set to the fixture values on each run.

Without a server: `node scripts/fixtures/seed-store.mjs --check` validates every fixture structurally;
add `--self-test` to prove the check fails on deliberately broken in-memory copies. `--no-image-files` skips the
image-file existence check entirely. Without it, the CI fixture photos (in this repo) are always checked, and the
`brand/...` images are checked only when `FIXTURE_BRAND_DIR/brand` exists; otherwise the check says so, loudly, for a job
without the sibling `mimora-client` checkout (this repo's CI). Seeding still reads every image, so a run with both repos
present covers them.

## Image references

A fixture names an image either by bare name (a `.jpg` in `scripts/fixtures/images`, or `FIXTURE_IMAGE_DIR`) or, when the
reference contains a `/`, by a path under the storefront's `public/` folder that keeps its own extension
(`brand/mimora/categories/Gift-Boxes.jpeg`, `.png` also read). That folder is `FIXTURE_BRAND_DIR`, default `../mimora-client/public`
(the sibling checkout, the same layout CI uses). Seeding only reads these files for their size and dimensions and stores the
root-relative URL; nothing is uploaded, because the storefront serves its own `public/`. The brand photos are deliberately not
copied into this repo. Both resolve through `resolveImageRef` in `check.mjs`, so the check and
the seeder cannot disagree about which file is meant.

## Safety guards

All fail before any write: `BACKEND_URL` and every `MONGODB_URI` host must be `localhost`/`127.0.0.1`/`::1` (single-label
service names such as `mongodb` only when `CI=true`); `mongodb+srv` is refused; `MONGODB_DB` must end in `-dev` or
`-test` or start with `store-fixture-`, unless the run names it explicitly with `--confirm-db <name>` (which must equal `MONGODB_DB`
exactly, and never relaxes the localhost rules); `OWNER_PASSWORD` must be at least 10 characters; an unknown `--store` lists the
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
