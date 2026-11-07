# Backend configuration

Derived from the code on 2026-10-24. The single source is
`src/server/core/config/env-validation.ts` (`ENV_VARS`): each variable is declared there with its
tier, whether it is a secret, and a validator, and `env-inventory.test.ts` fails when `src` reads a
variable the table does not declare — so this list cannot silently fall behind the code. Re-derive
before trusting it. Values are never written here — placeholders only. How to deploy: `deployment.md`.

**Tiers.** *required* — in production a missing or unusable one stops the process at boot
(`src/instrumentation.ts` → `assertProductionEnvironment`), with a message naming the variable and the
reason, never the value; outside production nothing is enforced. *capability* — switches a feature on;
absent is a legitimate OFF and is announced once by the module that owns it; **set but unusable** (a
secret under 32 characters, a non-https URL in production) is announced as an error, never fatal.
*optional* — has a safe default. A production **build** is exempt from the gate (the build host need
not carry runtime secrets).

Boot announces each configured-OFF capability once: `console.error` in production, `console.warn`
otherwise.

| Variable | Required | What breaks without it |
|---|---|---|
| `MONGODB_URI` | yes | Boot. Must point at a **replica set** — transactions (order placement) do not run on a standalone node. |
| `MONGODB_DB` | yes (production) | Code default is `store-platform-staff`, but production refuses to boot without it set: two environments must never share a database by default. Tests use `store-platform-staff-test`, fixtures `store-fixture-*`. |
| `STAFF_JWT_SECRET` | yes, ≥ 32 chars | Boot (refuses). `openssl rand -base64 48`. The `.env.example` placeholder is refused in production. |
| `CUSTOMER_JWT_SECRET` | yes, ≥ 32 chars | Boot (refuses). Different from the staff secret. Also keys guest order-tracking tokens: rotating it invalidates every guest tracking link. |
| `REVALIDATE_SECRET` | capability, ≥ 32 chars when set | Cache invalidation (announced). Must equal the storefront's value; its own secret, not shared with any other. |
| `STOREFRONT_REVALIDATE_URL` | capability (with `REVALIDATE_SECRET`) | Cache invalidation (announced). The storefront's `/api/revalidate`; https in production. |
| `STORE_ID` | yes | Boot (refuses) in production, and every request elsewhere (the guard is on everywhere but the test runner). The store's stable slug, `mimora`: 1-40 lowercase letters, digits and hyphens. Must equal the storefront's and the database's marker. See "Store identity" below. |
| `STORE_TIMEZONE` | yes | Dates, cut-off times and promised windows. IANA name; must equal the storefront's. |
| `STORE_PHONE_COUNTRY_CODE` | recommended | Without it national numbers (`010…`) are stored as typed, not as `+<cc>…` (announced). Digits only: `20` Egypt, `966` Saudi Arabia. **Must be the store's real country** — see `scripts/migrations/README.md` before setting it on a database that already has customers. |
| *(check)* | — | At boot the backend compares `STORE_PHONE_COUNTRY_CODE` with the store profile's own contact number and logs `[phone] … looks wrong` on a mismatch. Fixture value: `20` for the CI fixture shop, in both profiles (`scripts/fixtures/README.md`). Existing customer records are never rewritten; legacy forms keep signing in. |
| `CLOUDINARY_CLOUD_NAME` | yes for transfer payments | See below (announced). |
| `CLOUDINARY_API_KEY` | yes for transfer payments | See below (announced). |
| `CLOUDINARY_API_SECRET` | yes for transfer payments | See below (announced). Server-only, never `NEXT_PUBLIC_`. |
| `CUSTOMER_ACCESS_TOKEN_TTL` | no | Overrides the customer access-token lifetime: a number plus `s`/`m`/`h`/`d`. |
| `JOBS_SECRET` | capability, ≥ 32 chars when set | Authenticates `/api/internal/jobs/*` (`x-jobs-secret` header or `Authorization: Bearer`). Unset *and* `CRON_SECRET` unset: scheduled jobs OFF (announced). |
| `CRON_SECRET` | capability, ≥ 32 chars when set | What Vercel Cron sends as a Bearer token. Accepted by the jobs route exactly like `JOBS_SECRET`; on Vercel set this one only. |
| `CLIENT_IP_TRUSTED_HOPS` | no | How many right-most `X-Forwarded-For` entries are infrastructure you control (default `1`). Read by the rate limiter **and the audit log's IP**. |
| `TRUST_X_REAL_IP` | no | `1` only behind a proxy that overwrites `X-Real-IP`. |
| `SMTP_HOST` | yes, for email | SMTP relay hostname, e.g. `smtp.provider.example`. See "Outbound email" below (announced). |
| `SMTP_PORT` | yes, for email | `587` (STARTTLS, the default choice) or `465` (implicit TLS). |
| `SMTP_SECURE` | no | `true` only for port 465. Unset follows the port; a value that contradicts the port is reported as half-configured. |
| `SMTP_USER` | with `SMTP_PASS` | SMTP username. Omit both only for an unauthenticated relay (local development). |
| `SMTP_PASS` | with `SMTP_USER` | SMTP password or API key. Server-only; never logged. |
| `MAIL_FROM` | yes, for email | The sender, e.g. `Store Name <orders@shop.example>`. Must be an address the provider has verified. |
| `MAIL_REPLY_TO` | no | Where a customer's reply goes, e.g. `help@shop.example`. |
| `STOREFRONT_URL` | yes, once any mail variable is set | The storefront's public origin, e.g. `https://shop.example` — verification, reset and newsletter-confirmation links are built on it. |
| `BACKOFFICE_URL` | yes, once any mail variable is set | This console's public origin, e.g. `https://console.shop.example` — the staff invitation link is built on it. |

## Store identity

`STORE_ID` says which store this deployment serves; the database carries a marker (`storeidentity`, one document
`_id: "store-identity"` with `storeId`, `adoptedAt`, `adoptedVia`) saying which store it holds. `connectToDatabase()` compares
them once per process, after the index check, and refuses on any disagreement. Choose the slug once (a short, stable,
lowercase name for the store: `mimora`, `qahwa`) and never change it after adoption; a rename means deliberately editing the
marker in that database and `STORE_ID` on the backend and the storefront together. The storefront carries the same
`STORE_ID`, and reads this backend's answer from `GET /api/storefront/identity`. Adoption procedure, refusals and the
production checklist: `deployment.md` → Store identity. The adoption command's guarantees: `scripts/admin/README.md`.

**Enforcement.** Everywhere, except the automated test runner (`NODE_ENV=test`) with `STORE_ID` unset — the integration
suites use many throwaway, unmarked databases. A test that exercises the guard sets `STORE_ID`.

**Local development: a one-time adoption.** After pulling this change your dev database has no marker, so the backend
will refuse to start against it. Add `STORE_ID=<slug>` to `.env.local` (any slug you choose for local work, e.g. `mimora`
for the Mimora store; the storefront's `.env.local` carries the same value), then once per database:

```bash
MONGODB_URI='mongodb://localhost:27020/?replicaSet=rs0&directConnection=true' MONGODB_DB=store-platform-staff-dev \
  node scripts/admin/adopt-store-identity.mjs --store-id mimora --confirm-db store-platform-staff-dev --dry-run
# read the preflight, then run again without --dry-run
```

A database you drop and recreate (a fixture database, a fresh `-dev`) needs adopting again before its first boot.
Fixture databases (`store-fixture-ci-default`, `store-fixture-ci-alternate`) are adopted by the storefront's `scripts/ci/configuration-proof.sh`; `scripts/fixtures/seed-store.mjs`
never adopts (see `scripts/fixtures/README.md`).

## Outbound email (Nodemailer over SMTP)

Owner decision: email goes out through **Nodemailer over whichever SMTP provider
the owner configures** — a provider swap is a change of these variables, not of
code. Values are set by the owner in the host's secret store (`.env.local`
locally); this repository never contains one.

**Boot announces which of three states the process is in**, once, from
`src/instrumentation.ts` (`console.error` in production, `console.warn`
otherwise; plain `console.log` when configured):

| State | When | Behaviour |
|---|---|---|
| configured | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `STOREFRONT_URL`, `BACKOFFICE_URL` valid, and `SMTP_USER`/`SMTP_PASS` both present or both absent | Email is delivered over a pooled SMTP connection. `requireTLS` is forced on port 587. |
| OFF | none of `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_REPLY_TO` is set | Nothing is delivered. The announcement says so; each would-be message is logged as its **template name and a masked recipient only**. |
| half-configured | some set, some missing or invalid | Same as OFF, and the announcement names the missing or invalid variables **by name only** (`half-configured: missing or invalid SMTP_PASS, MAIL_FROM`). A set `STOREFRONT_URL`/`BACKOFFICE_URL` alone does not count as "mail set". |

Never logged, in any state: a token, a message body or subject, a password, a
full recipient address. A failed send logs the template name, the recipient's
domain and the SMTP error code, and **never fails the flow that triggered it** —
sign-up, password reset, order transitions and staff invitations all complete
whether or not mail is configured or working.

What is sent: email-verification and password-reset **links** (`<STOREFRONT_URL>/<locale>/verify-email?token=` and `/reset-password?token=`), the newsletter **confirmation** link (`/newsletter/confirm?token=`, see below), the staff invitation link (`<BACKOFFICE_URL>/accept-invite?token=`), and order emails. The language is the store profile's default locale (`ar` renders RTL). Order emails are sent only for an event the merchant has switched on: in **Settings → Notifications**, choose the event from the list and tick **Email** (no rule, no email — nothing is sent by default). Events that send mail: `ORDER_PLACED`, `ORDER_CONFIRMED`, `PAYMENT_VERIFIED`, `PAYMENT_REJECTED`, `ORDER_SHIPPED`, `ORDER_READY_FOR_PICKUP`, `ORDER_COLLECTED` (a pickup order's last step; says "collected", never "delivered"), `ORDER_DELIVERED`, `ORDER_CANCELLED`, `PAYMENT_REFUNDED`, `REFUND_ISSUED`. Any other event sends none. An order with no contact email is simply not emailed.

**Order emails do not hold the HTTP response.** The transport is an SMTP round trip, so the email step is dispatched with `after()` from `next/server` once the response has been sent (and, outside a request — a script, a test — as a non-blocking promise). A slow or unreachable mail server therefore costs the customer's request nothing; a failure is logged by error name only.

### Newsletter double opt-in

A **public** subscribe (footer, checkout) never subscribes anyone — anyone can type anyone's address. It records a `PENDING` row and, when mail is configured, emails the address a single-use link (`<STOREFRONT_URL>/<locale>/newsletter/confirm?token=`). The token is stored only as a SHA-256 hash, expires after 48 hours, and is cleared on use; following the link marks the row `SUBSCRIBED` with `consentedAt`/`confirmedAt`. A pending address asking again is re-sent a link at most every 10 minutes. The answer to the public request is byte-identical for every state (new, pending, subscribed, unsubscribed).

- **Mail OFF or half-configured:** no link can be sent, so the row **stays `PENDING`** (with no token), and the console's Newsletter screen shows it as *Pending — unconfirmed* with a note saying so. Pending is not consent; no sender may treat it as such. When mail is later configured, the address's next request issues its link.
- A signed-in customer turning marketing consent on for their own address is an authenticated act and subscribes directly (also promoting a pending row). Withdrawing consent, or an unsubscribe in the console, also kills a pending link.
- Changing the profile email while consent is granted **moves** the subscription: the old address is unsubscribed and the new one subscribed, in the same transaction as the customer row.

## Receipt uploads (bank transfer, InstaPay, wallet)

Every payment method with `requiresProof` is paid by uploading a receipt, and
an order on such a method **cannot be shipped, readied for pickup or delivered
until staff verify that receipt** (`engines/order-state`, `paymentAllowsTransition`).
So without working uploads these methods take orders that can never ship.

What is needed:

1. A Cloudinary account (any plan). From its dashboard → API Keys: the
   **cloud name**, an **API key** and its **API secret**, set as the three
   variables above in the backend's environment only (`.env.local` locally;
   the host's secret store in production). The storefront never needs them.
2. Nothing to configure in Cloudinary itself: receipts are uploaded with
   `type: "private"` (`backend-toolkit-cloudinary` `createCloudinaryPrivateAssets`),
   which Cloudinary supports by default. A private asset is not delivered from
   the CDN at all; staff see it through a signed URL minted per request, valid
   5 minutes (`PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS`). Do **not** switch the
   folder or account to public delivery — a receipt is a customer's bank data.
3. Accepted files: JPEG, PNG, WebP, HEIC, up to 8 MB
   (`PAYMENT_PROOF_UPLOAD_POLICY`). Stored under `mimora/payment-proofs/orders/<orderNumber>/`.

**End-to-end verification once the credentials exist** — scripted, so it runs
the same way every time (`mimora-client/scripts/qa/receipt-e2e.mjs`; no mock
anywhere, and an unconfigured backend is reported BLOCKED, never passed):

```bash
# 1. backend: put the three CLOUDINARY_* values in mimora-staff/.env.local (git-ignored),
#    restart it, and confirm the boot log no longer prints "[uploads] … not set"
# 2. storefront running in front of it (a store offering WALLET/INSTAPAY to guests — the `ci-default` fixture profile)
cd mimora-client
OWNER_EMAIL=… OWNER_PASSWORD=… node scripts/qa/receipt-e2e.mjs              # ~1 min
OWNER_EMAIL=… OWNER_PASSWORD=… WAIT_FOR_EXPIRY=1 node scripts/qa/receipt-e2e.mjs   # + the 5-minute link expiry
```

It checks: upload through the storefront UI; the stored bytes equal the
uploaded file; no public CDN delivery of the asset (private); a tampered
signature is refused; staff open it via the authorised queue's signed link;
verify → the order can ship; a second order rejected → it still cannot ship, the
customer sees the reason and can upload again; the SERVER (not just the
storefront) refuses a wrong type, a disguised file (PDF bytes labelled JPEG) and
an oversized file; no token and another order's token are refused like a missing
order; the queue needs a staff session; and (with `WAIT_FOR_EXPIRY=1`) the link
dies after 5 minutes. Staff permission negatives (verify/reject/queue → 403) are
covered by `receipt-permissions.integration.test.ts`.

## `.env.example`

`.env.example` lists every declared variable with a placeholder and a one-line comment. `node ../docs/tasks/check-env-example.mjs $PWD` checks it against the code: every application variable matches in both directions. It also reports `OWNER_EMAIL`, `OWNER_PASSWORD` and `FIXTURE_MANIFEST_OUT`; those are read only by `scripts/fixtures/seed-store.mjs`, are never application configuration, and do not belong in `.env.example`, so that report is expected noise.

## Staff notifications expire

`StaffNotification` documents carry `expiresAt` (event time + 90 days) with a TTL index (`expireAfterSeconds: 0`); MongoDB's background monitor removes them about a minute after they expire. The TTL is on its own field rather than on `at` because `at` already has a plain index in existing databases and MongoDB refuses to turn that into a TTL index. Notices written **before** this field existed have no `expiresAt` and are never removed; to bring them under the same rule, once per database:

```js
db.staffnotifications.updateMany({ expiresAt: { $exists: false } }, [{ $set: { expiresAt: { $add: ["$at", 7776000000] } } }])
```

## Lockfile after the dependency-range change — resolved 2026-10-22

`package.json` pins `@kira-joo/backend-toolkit-cloudinary` and
`@kira-joo/toolkit-common` to `^1.0.0` (were `*`). The lockfile was regenerated
by npm, not edited: `npm install --package-lock-only --ignore-scripts`. No GitHub
Packages credential was needed — npm reuses the `@kira-joo` entries already
pinned in the lockfile and only consults public npm. The diff is the two root
specs plus filled-in metadata for six bundled packages of the optional
`@tailwindcss/oxide-wasm32-wasi` (WebAssembly-only, not installed on this
platform). `npm ls --package-lock-only` validates. (An earlier `--offline`
attempt failed on that optional package; the 401 from GitHub Packages was never
actually in the way.)
