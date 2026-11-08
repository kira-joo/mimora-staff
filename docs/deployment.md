# Deployment — backend and console

> **Status: prepared, never performed.** Nothing described here has been deployed. No account, project,
> database, domain or credential was created, and no value below is real. The owner creates the services and
> fills in the secrets; this document says exactly which, and the app's boot gate refuses to start in production
> if a required one is missing or unusable. See `../../docs/deployment-deferred.md` for why deployment waited,
> and the list at the end of this file for what is **not yet verified** because it can only be verified deployed.

This repository is the single backend for the storefront (`../../mimora-client`) **and** the staff console.
It is one Next.js application: the console pages and every `/api/**` route are served from one origin, so the
console needs no CORS and no cross-origin cookies. The storefront is a second, separate deployment that talks
to this one only server-to-server.

## Topology

| Piece | What | Notes |
|---|---|---|
| **Backend + console** | this repo, one Vercel project | `api.example.com` (a placeholder — pick the real name). Console and API share the origin. |
| **Storefront** | `mimora-client`, a second Vercel project | `shop.example.com`. See its `docs/deployment.md`. |
| **MongoDB** | a **replica set**, e.g. Atlas | Order placement is a transaction; a standalone node cannot run it. |
| **Cloudinary** | one product environment **per store** | `../../docs/store/phases/07-cloudinary-isolation-plan.md`. |
| **SMTP** | any provider, over Nodemailer | `../../docs/store/phases/07-email-provider-research.md`. |

The two services can be up or down independently. The storefront renders an explicit absent state when the
backend answers badly; nothing in the backend depends on the storefront being up except cache invalidation,
which is best-effort by design.

## Host-agnostic by design

Vercel is the documented primary target, but nothing here requires it: `npm ci && npm run build && npm run start`
runs the whole application on any Node host (a VM, a container, Railway, Render, Fly). What differs elsewhere:

- **No scheduled jobs.** Nothing runs on a timer, on Vercel or anywhere else (see `vercel.json` below), so there is no
  scheduler to set up.
- **TLS.** Cookies are `Secure` outside development, so the app must be reached over https (or `localhost`).
  Terminate TLS at the host or a proxy.
- **Client IP.** Set `CLIENT_IP_TRUSTED_HOPS` to the number of proxies you control (see "Client IP" below).
- **A persistent process** keeps one pooled SMTP connection and one Mongo connection; serverless re-creates them
  per instance. Both work.

## Build and runtime

| | |
|---|---|
| Node | **24.x** (what CI runs; Next 16 needs at least 20.9). Set it in Vercel's Project Settings → Node.js Version. |
| Install | `npm ci` |
| Build | `npm run build` (`next build`). The build needs **no** database and no runtime secret. |
| Start | `npm run start` (`next start`). Vercel runs its own server; this is for other hosts. |
| Framework | Next.js (`vercel.json` says so; there are no rewrites, headers or functions overrides). |

**Private packages.** The `@kira-joo/*` toolkits come from GitHub Packages (`https://npm.pkg.github.com`), not public
npm, so the install step needs a read credential. The repository's CI writes an `.npmrc` at job time from a
`PACKAGES_READ_TOKEN` secret (`.github/workflows/verify.yml`); there is deliberately **no auth line in any tracked
file**. On Vercel, add the credential as an environment variable the way Vercel documents for private registries
(an `NPM_RC` variable holding `@kira-joo:registry=https://npm.pkg.github.com` and
`//npm.pkg.github.com/:_authToken=<a read:packages token>`; confirm the exact mechanism in Vercel's current
docs before relying on it). Never commit the token, and never paste it into a tracked `.npmrc`.

## `vercel.json`

```json
{ "$schema": "https://openapi.vercel.sh/vercel.json", "framework": "nextjs" }
```

**No Vercel Cron Jobs — deliberately** (owner decision; it also keeps the project within the free Hobby plan, which
allows a cron at most once a day). The two maintenance sweeps are staff actions instead:

- **Cancel unpaid orders** (Orders page; `POST /api/admin/orders/expire-unpaid`, `Order.transition`). Cancels orders
  still awaiting payment past their payment method's auto-cancel window (`autoCancelMinutes`, Settings → Payments) and
  releases their stock. A method with no window is never touched. Idempotent: a second press cancels nothing new.
- **Clean up unused images** (Catalog → Bulk import; `POST /api/admin/media/sweep-orphans`, `Catalog.publish`).
  Catalog images upload before the record that shows them is saved, so an upload nobody saves is an orphan file in
  Cloudinary. Each public upload is recorded in a `PendingUpload` collection; the action permanently deletes the ones
  older than 24 hours that no product, variant, category, collection, store profile or page references (referenced
  ones are just forgotten, never destroyed), oldest first, one batch per press. It only ever deletes under
  `mimora/store/`, answers Checked / Kept / Deleted / Failed counts, and is idempotent.

## Environment variables

Declared once in `src/server/core/config/env-validation.ts`; the full explanation is `configuration.md`, and the
reviewed, commented template is `docs/env-example.txt` (install it with `cp docs/env-example.txt .env.example`). It tags every variable
**[per store]**, **[per environment]**, **[pair]** (must equal the storefront's) or **[secret]**. **Secret = set it in the host's secret store, never in a tracked
file.** Tiers: *required* stops a production boot; *capability* switches a feature on, absent is announced.

| Variable | Tier | Secret | Set it to |
|---|---|---|---|
| `MONGODB_URI` | required | **yes** | The replica-set connection string (carries credentials). |
| `MONGODB_DB` | required | no | A database name unique to this environment. |
| `STAFF_JWT_SECRET` | required | **yes** | `openssl rand -base64 48`. |
| `CUSTOMER_JWT_SECRET` | required | **yes** | A *different* `openssl rand -base64 48`. Rotating it invalidates guest tracking links. |
| `STORE_ID` | required | no | This store's slug (`mimora`), equal to the storefront's. See **Store identity**. |
| `STORE_TIMEZONE` | required | no | IANA zone, equal to the storefront's. |
| `STORE_PHONE_COUNTRY_CODE` | capability | no | Digits, the store's real country. |
| `STOREFRONT_REVALIDATE_URL` | capability | no | `https://shop.example.com/api/revalidate`. |
| `REVALIDATE_SECRET` | capability | **yes** | Equal to the storefront's value; its own secret. |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | capability | key and secret: **yes** | This store's own Cloudinary environment. All three or none. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_REPLY_TO` | capability | `SMTP_PASS`: **yes** | Per `configuration.md` → Outbound email. |
| `STOREFRONT_URL`, `BACKOFFICE_URL` | capability (required once mail is set) | no | The two public origins, https. |
| `CUSTOMER_ACCESS_TOKEN_TTL`, `CLIENT_IP_TRUSTED_HOPS`, `TRUST_X_REAL_IP` | optional | no | See `configuration.md`. |

`NODE_ENV` and `NEXT_RUNTIME` are set by Next; do not set them.

**No two secrets share a value** (`STAFF_JWT_SECRET`, `CUSTOMER_JWT_SECRET`, `REVALIDATE_SECRET`, and the jobs
secret): the boot gate refuses an identical staff/customer pair and reports any other reuse by name.

**Previews are production-mode builds.** A Vercel preview runs with `NODE_ENV=production`, so the same boot gate
applies. Give previews their **own** `MONGODB_DB` (and preferably their own cluster user) and their own secrets;
never point a preview at the production database.

## MongoDB

- **Replica set required.** Atlas (any tier that is a replica set; a free shared cluster is one) works. The boot
  warns if a `mongodb://` URI names no `replicaSet`; an `mongodb+srv://` Atlas URI is a replica set by construction.
- **Indexes build at first connect.** `ensureIndexes()` builds every declared index and **refuses to start** if
  one cannot be built. On a fresh database that is a few seconds of first-request latency; on an existing one, a
  duplicate that blocks a unique index is the "refusing to start" message — reconcile the data, do not bypass it.
- **Network access.** Vercel functions have no fixed egress addresses on standard plans, so an Atlas IP
  allow-list of specific addresses will not work; use Atlas's Vercel integration / private connectivity if
  available to your plan, or an allow-list of `0.0.0.0/0` **with** a strong database user (decide deliberately).
- **Latency and limits.** Keep the cluster in the region of the functions; each serverless instance holds its own
  connection pool, so mind the cluster's connection limit under load.
- **TTL data** (rate-limit counters, staff notifications at 90 days) is removed by MongoDB's own monitor.
  Notifications written before the TTL field existed need the one-off backfill in `configuration.md`.

## Origins, cookies and CORS

- **No CORS is needed or configured.** The browser talks only to the origin that served it. The storefront's server
  calls this backend server-to-server; the console's calls are same-origin.
- **Cookies are host-only** (no `Domain` attribute), `HttpOnly`, `SameSite=Lax`, and `Secure` whenever
  `NODE_ENV` is not `development`. Staff cookies live on **this** origin; the storefront keeps its own `sf_*`
  cookies on **its** origin and forwards the backend's values server-side. Because neither sets a `Domain`, the
  two origins never see each other's cookies, even as sibling subdomains of one domain. **Do not add a `Domain`.**
- The refresh cookies are scoped to path prefixes (`staff`: see `staff-auth.constants.ts`; `customer`:
  `/api/shop/auth/`). Clearing re-sends the same path. Do not "simplify" a path to `/`.
- Because cookies are `Secure`, **http only works on `localhost`.** A staging host on plain http will accept the
  login and then appear logged out.
- Email links are `GET` navigations from another site; `SameSite=Lax` sends the session cookie for them, and the
  token-carrying pages (`verify-email`, `reset-password`, `newsletter/confirm`) work signed in or out.

## Cache-invalidation pairing

The backend publishes tag invalidations to the storefront after each successful admin mutation. Both halves must
be configured, and the secret must be identical:

| This backend | Storefront |
|---|---|
| `STOREFRONT_REVALIDATE_URL=https://shop.example.com/api/revalidate` | route `/api/revalidate` exists |
| `REVALIDATE_SECRET=<S>` | `REVALIDATE_SECRET=<S>` |

A `404` from the storefront's receiver means the secrets differ (or the URL is wrong) — the receiver answers `404`
to anything it does not trust, by design. If Vercel **Deployment Protection** is on for the storefront deployment,
the backend's request is stopped before it reaches the receiver; production deployments are not protected by
default, preview ones are. Confirm the invalidation reaches `204` after the first deploy (smoke checklist).
Unconfigured or half-configured, the backend says so once at boot (`[revalidation]`) and the storefront announces
`REVALIDATE_SECRET` OFF.

## Cloudinary

Receipts are `type: "private"` and read only through a short-lived signed URL; do **not** switch the account to
public delivery. Use **one Cloudinary product environment per store deployment** with a non-root key, and never
the nutrition product's cloud. The full plan, the strict-transformations setting and the reasoning are in
`../../docs/store/phases/07-cloudinary-isolation-plan.md`. Without the three variables, every transfer-type payment
and every catalog image upload fails; boot says so (`[uploads]`).

## Email and DNS

Email is Nodemailer over SMTP; a provider swap is a change of the `SMTP_*` / `MAIL_FROM` variables, not of code.
The provider comparison and the failure modes of each are in
`../../docs/store/phases/07-email-provider-research.md`. Before sending from a domain, publish the DNS records the
provider asks for — typically **SPF**, **DKIM** (a CNAME or TXT the provider generates) and a **DMARC** policy —
and verify the sender address or domain in the provider's dashboard; `MAIL_FROM` must be an address it has
verified. Use port 587 (STARTTLS is forced on) or 465 with `SMTP_SECURE=true`. With mail OFF the app still runs:
nothing is delivered, and each would-be message is logged by template name and masked recipient only. Newsletter
sign-ups then stay `PENDING` (see `configuration.md`).

## Client IP and rate limits

Per-address rate limits key on `resolveClientIp`, which believes only an `X-Forwarded-For` entry a trusted proxy
appended (`CLIENT_IP_TRUSTED_HOPS`, default `1`). **Known gap, not verified in a deployment:** the storefront forwards the
customer's address to this backend in `X-Forwarded-For`, but **Vercel overwrites that header** on the way in
(to stop spoofing), so on Vercel the backend will probably see the storefront function's egress address for every
customer. The consequence is that per-address limits become one shared bucket (stricter, never looser; the
per-account limits on login and password reset are unaffected). Measure it after the first deploy (smoke
checklist). Staff console traffic arrives from browsers directly and is attributed correctly, including in the audit log.

## Store identity

One deployment serves one store, and the code has no store field. Point two deployments at one `MONGODB_DB` and
their customers, orders and stock merge silently. So the database says whose it is: a single marker document
(collection `storeidentity`, `_id: "store-identity"`, fields `storeId`, `adoptedAt`, `adoptedVia`), and every backend
process checks it once, right after it connects (inside `connectToDatabase`, after the index check). The storefront
reads the verified answer from the public route `GET /api/storefront/identity` (`{ "storeId": "…" }`, never cached) and
compares it with its own `STORE_ID`.

**Choosing `STORE_ID`.** A short, stable, lowercase slug per store: 1-40 characters of `a-z`, `0-9` and `-`, starting
and ending with a letter or digit (`mimora`, `qahwa`). It names the store, not the environment: production and a
preview of the same store do not share a database, so each database is adopted once under the store's slug. **Never
change it once adopted.** Renaming means deliberately editing the marker document by hand in that database (and
changing `STORE_ID` on both deployments together); no script does it, on purpose.

**What the backend refuses** (it will not start, or serve a request, until fixed; the marker is never created or
overwritten by the backend):

- `STORE_ID` missing or malformed;
- the database has no marker: the message names the database and the adoption command;
- the marker names a different store: `database <db> belongs to store '<marker>', this deployment is configured as '<STORE_ID>'`.

These are logged (the boot log, or the request log for a route); the HTTP body of a refused request is a generic 500.
A corrected configuration recovers without a restart of the process.

**Adopting a database (once per database, before its first boot):**

```bash
# 1. dry run: prints what is in the database and writes nothing
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/adopt-store-identity.mjs \
  --store-id mimora --confirm-db <db> --dry-run
# 2. read the preflight: database, hosts, store name (ar/en) and currency, product/order/customer counts.
#    Is that the store you mean? If it is another store's data, STOP: you have the wrong MONGODB_DB.
# 3. adopt (an atomic insert-if-absent; the same command twice changes nothing)
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/adopt-store-identity.mjs \
  --store-id mimora --confirm-db <db>
```

`--confirm-db` must equal `MONGODB_DB` exactly, local or not. A brand-new empty database is adopted the same way,
**before** the first boot: the guard stops the boot against an unmarked database, and the boot is what seeds the
default roles. Nothing but this command writes the marker. Full guarantees: `scripts/admin/README.md`.

**The storefront must carry the same `STORE_ID`** (its own environment variable, paired with this one). Deploy both
with the same value; the storefront checks this backend's `/api/storefront/identity` answer against its own.

## First Owner

A new deployment has no staff account. After the database is adopted (**Store identity**) and the backend has booted
once against it (it seeds the default roles at boot), create the first Owner from a machine you control:

```bash
# 1. dry run: checks everything, writes nothing
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/bootstrap-owner.mjs \
  --email owner@example.com --name "Owner Name" --dry-run --confirm-production=<db>
# 2. create; the single-use code is printed once, valid one hour
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/bootstrap-owner.mjs \
  --email owner@example.com --name "Owner Name" \
  --backoffice-url=https://api.example.com --confirm-production=<db>
```

The Owner enters the code at `<BACKOFFICE_URL>/accept-invite` and chooses their own password. Full guarantees and
`--reissue` are in `scripts/admin/README.md`. Mail exists now (staff invited from the console get an email when mail
is configured), but this script still prints the code instead of emailing it, on purpose: it must work with mail OFF.

## First-deploy checklist

Every step is an external action for the owner; none has been done.

1. Create a MongoDB replica set (Atlas); create a database user; note the connection string. Decide network access.
2. Create a Cloudinary product environment for this store and a non-root API key.
3. Choose an SMTP provider; verify the sender domain/address and publish SPF, DKIM and DMARC.
4. Create the Vercel project from this repository (framework Next.js, Node 24); add the private-registry credential.
5. Generate secrets: `STAFF_JWT_SECRET`, `CUSTOMER_JWT_SECRET`, `REVALIDATE_SECRET` — three different
   `openssl rand -base64 48` values. Store them in Vercel, not in git.
6. Choose the store's `STORE_ID` and adopt the (empty) database with `scripts/admin/adopt-store-identity.mjs`
   (**Store identity**, dry run first). Set `STORE_ID` here and, identically, on the storefront.
7. Set every *required* variable, then the capabilities (revalidation, Cloudinary, SMTP and both URLs)
   for **Production**; give Preview its own database name and secrets.
8. Attach the domain (`api.example.com`, a placeholder) and let TLS provision.
9. Deploy. Read the boot log: a missing or invalid required variable names itself and the process exits; every
   capability left OFF prints one line (`[revalidation]`, `[mail]`, `[uploads]`, `[phone]`).
10. Create the first Owner (above).
11. Deploy the storefront with the same `STORE_ID`, `REVALIDATE_SECRET`, `STAFF_API_URL` and `STORE_TIMEZONE`; then set
    `STOREFRONT_REVALIDATE_URL`/`STOREFRONT_URL` here and redeploy.
12. On any database that already holds products (a restore, or an upgrade past a release that added listing fields),
    sign in as an Owner and press **Rebuild listings** (Catalog → Bulk import), or
    `POST /api/admin/catalog/rebuild-listings` with the `Catalog.publish` permission. It recomputes every product's
    listing rollup (price range, available options, low-stock facts) in batches and then refreshes the storefront's
    `PRODUCTS` tag. Products written before a rollup field existed lack it, so the storefront's option filters would
    leave them out. Idempotent; a fresh, empty database needs nothing.

## Post-deploy smoke checklist

Replace `api.example.com` / `shop.example.com` with the real origins. Tick each; record what was seen.

- [ ] `curl -sI https://api.example.com/login` → `200` (the console's sign-in page is served).
- [ ] Sign in as the Owner at `/login`; the cookies are `Secure; HttpOnly; SameSite=Lax`; a reload stays signed in; sign out, and the cookies are gone.
- [ ] `curl -s https://api.example.com/api/storefront/identity` → `{"storeId":"<this store's STORE_ID>"}`, and the storefront's own `STORE_ID` is the same.
- [ ] `curl -s https://api.example.com/api/storefront/store-profile` → the store profile JSON (public surface works, DB reachable).
- [ ] Boot log shows no `[config]`, `[revalidation]`, `[mail]` or `[uploads]` line you did not intend.
- [ ] Edit a price in the console; the storefront page shows it within seconds (invalidation reached `204`, not `404`).
- [ ] The Vercel project's Cron Jobs page lists no jobs.
- [ ] As the Owner, press **Cancel unpaid orders** (Orders) and **Clean up unused images** (Catalog → Bulk import); each confirms first and reports its result.
- [ ] Place a test order through the storefront; with email on and `ORDER_PLACED` switched on in Settings → Notifications, the confirmation arrives, and the placement response was not delayed by it.
- [ ] Upload a receipt on a transfer order; staff can open it via the signed link, and the plain Cloudinary URL does not serve it.
- [ ] Subscribe an address from the footer; the confirmation email arrives; the link confirms; the console Newsletter screen shows *Subscribed*.
- [ ] Trigger a password reset; the link opens the storefront's reset page.
- [ ] **Client-IP measurement:** from two different networks, hit a rate-limited public route (e.g. newsletter subscribe) and compare the `ratelimits` keys in the database. If both show the same address, the gap above is real; decide on a mitigation.
- [ ] Backups: confirm the database's snapshot schedule and who can restore it. Order data is not reconstructable.

## Not verified (because it can only be verified deployed)

- The private-registry install on Vercel.
- Cookie `Secure`/`SameSite` behaviour across the real pair of domains.
- Whether the storefront's forwarded client address survives Vercel's proxy (expected: it does not).
- SMTP delivery, SPF/DKIM/DMARC alignment, and Cloudinary `type: "private"` against the live service.
- Latency and connection-limit behaviour against a remote replica set.
