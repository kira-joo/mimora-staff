# mimora-staff — Mimora backoffice and backend

Mimora's operational backoffice, **and the single backend for Mimora's two
applications** (this console and the `mimora-client` storefront). This file is
the working contract for this repository. Authoritative detail lives in
`docs/MDS.md` (inherited from the template: where it describes a reusable
multi-merchant platform, this file wins).

## Repository model — one brand, one repository pair, one deployment

- **This repository manages Mimora's own catalog, orders and settings, and
  nothing else.** Every settings document is a per-deployment singleton and no
  schema carries a store or tenant field; one deployment talks to one database.
  Do not add multi-store or tenant logic.
- **The store-identity guard is load-bearing.** `STORE_ID=mimora` must match the
  marker in the database (`storeidentity`, written only by
  `scripts/admin/adopt-store-identity.mjs`); `connectToDatabase` refuses any other
  database before writing anything, and `GET /api/storefront/identity` lets the
  storefront refuse any other backend. Never weaken, bypass or auto-write it.
- **It was created from the reusable template** `store-platform-staff@dd0d69b`.
  The template is a source, never a dependency: nothing here may import, read,
  build from or check out `store-platform*`. Template improvements are ported
  deliberately; Mimora-specific work never flows back. A future brand gets its
  own repository pair and deployment.
- **Local database naming is inherited, not meaningful.** The local Mimora
  database is still called `store-platform-staff` (adopted as `mimora`), the
  `MONGODB_DB` default and the Docker container/volume keep template names, and
  integration tests use throwaway `*-test-*` databases. Renaming any of them is a
  data migration that needs an explicit, owner-approved plan — never a drive-by.
- **Fixtures:** `scripts/fixtures/stores/mimora.mjs` is local sample data for
  Mimora's own database (seeded only with `--confirm-db`). The CI fixture shop is
  fictional, never Mimora's catalog, and is seeded only into throwaway
  `store-fixture-*` databases.

## What this application is

Two products in one repository, and the distinction drives every design choice:

| | Who | Optimised for |
|---|---|---|
| **Operations mode** — orders, fulfilment, inventory, returns | Warehouse, packing, support | Speed, glanceability, large targets, one-tap actions |
| **Management mode** — catalog, content, settings, reports | Owner, manager, merchandiser | Completeness, correctness, confidence before publishing |

It is **not** a dashboard of decorative cards, not an admin template, and **not
a smaller version of the storefront** — it must not inherit the storefront's
visual identity.

It is also the backend: every schema, repository, DTO, business rule, and API
route for both Mimora applications lives here.

## Sibling repositories

This repo sits beside independent sibling repositories, including the storefront
(`mimora-client`) and a set of shared `@kira-joo/*` packages published to GitHub
Packages. No monorepo tooling, no shared lockfile, no root `package.json`.

**Never work from a remembered list of packages or versions — derive them:**

```bash
ls -d ../*/ | sed 's|../||;s|/||'     # sibling repositories
grep -h '"name"' ../*/package.json     # package names
```

## Stack

Next 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 ·
Mongoose/MongoDB · React Query · react-hook-form · Axios ·
class-validator/class-transformer · the full `@kira-joo` backend toolkit.

**Target Tailwind 4.** `@kira-joo/frontend-toolkit-tailwind@1.0.0` declares
`tailwindcss: "^3.4.0 || ^4.0.0"` as a peer and ships a real, tested v4
`@theme`/`@source` contract (`theme.css`), alongside the v3 JS preset kept for
one release. Every actual consumer in the workspace — `restaurant-platform`,
`restaurant-platform-staff`, `nutrition-client`, `nutrition-staff`, `portfolio`
— is on `tailwindcss ^4.3.3`; none remain on 3.

**`reflect-metadata` is imported once, in `src/instrumentation.ts`.** Do not
scatter self-imports through DTO files; without the polyfill loaded first,
decorators silently produce empty schemas and DTOs that validate nothing.

## The three API surfaces

| Surface | Auth | Caching | CORS |
|---|---|---|---|
| `/api/storefront/**` | `auth: false` + `force-dynamic` | ISR + cache tags | not needed |
| `/api/shop/**` | **customer**, resolved in-handler | never | **not needed** — all traffic is server-to-server |
| `/api/admin/**` | **staff** JWT + permissions | never | not needed |

Keeping these separate is what makes one backend safe for two audiences. **A
route in the wrong group is a security bug, not a tidiness issue.**

### `/api/shop/**` declares `auth: false`, and that is deliberate

The toolkit's global `auth` block resolves **one audience per application**, and
here that audience is *staff*. A shop route declaring `auth: true` would
authenticate a customer against `staffusers` — the exact cross-audience failure
the separation exists to prevent. So the shop surface opts out and resolves its
own actor: `requireCustomer()` for routes needing an account,
`resolveShopActor()` where a guest is legitimate. **A present-but-invalid token
is an error, never a silent downgrade to guest.**

**Because `auth: false` means two different things**, the shop surface carries a
route-coverage test that fails unless every `/api/shop/**` route calls
`requireCustomer`, calls `resolveShopActor`, or sits on a named, justified
allowlist. Without it, a route that forgets `requireCustomer` is silently public
and nothing says so. The admin coverage test asserts a **non-empty** permissions
array, not merely the presence of an `auth: {` block.

## Authentication

The workspace-wide contract is `../docs/authentication-architecture.md`. Read it
before touching anything in the auth path.

## Non-negotiables

1. **Money is never a float.** `Money` is `Decimal` in major units, stored as
   BSON `Decimal128` via `moneyField()`. **Never take `moneyField(...).type`** —
   it keeps the BSON type and silently drops the rounding setter and the reviving
   getter. Currency is not part of an amount; `StoreProfile` carries it.
2. **A variant owns its price and its stock, absolutely.** There is no base
   price plus a delta — that model has two sources of truth for one price.
   `Product` carries no price and no stock.
3. **Order placement is one transaction.** Re-price, re-check purchasability,
   decrement per-variant stock, allocate the order number, snapshot everything,
   create the order, clear the cart — all inside `withTransaction`, or none of
   it. **This requires a replica set.**
4. **Oversell prevention puts the quantity predicate inside the update filter.**
   A read-then-write is not a guard. Duplicate variants in one order are
   aggregated and decremented in canonical sorted order — one session cannot run
   parallel operations, so a multi-line order decrements sequentially.
5. **Orders snapshot what was purchased, including the SKU.** Product and variant
   ids, SKU, option labels as shown, unit price, tax treatment, the payment
   destination, the shipping zone and fee, the applied promotion, and unit cost.
   Renaming a product or changing a price must never alter a historical order.
6. **Order status and payment status are separate axes.** A COD order progresses
   while unpaid; a transfer order can be paid before it is accepted. Never
   collapse them.
7. **Every state transition is validated against an explicit allowed-transitions
   map** and appends to the order timeline with actor, timestamp and reason. An
   invalid transition is a `ConflictError`, never a silent no-op.
8. **Every write that can move money is idempotent** by `Idempotency-Key`,
   **scoped by route and actor before uniqueness** — a raw global client key is a
   cross-user replay hazard.
9. **Two auth audiences never share a secret, a cookie, a collection, or a
   redirect.**
10. **Authorization always runs server-side.** A permission guard hides UI; it
    never grants access. Every `/api/admin/**` route declares its own
    `auth: {permissions}`.
11. **The payment destination is configuration.** Never hardcoded, always
    snapshotted onto the order, always audited when changed.
12. **Repositories are database-only.** They never make external calls, never
    publish a cache invalidation, never send a notification. Those belong to the
    route-factory layer, the only place that knows a real HTTP mutation happened
    — a repository is also called from migrations, scripts and bulk jobs.
13. **A capability configured OFF announces itself loudly, once, at startup, in
    production.** Silence is correct for a *runtime* absence and wrong for a
    configured one.

## Cache invalidation — the mechanism is silent by default, and that is on us

`backend-toolkit-next`'s `runRevalidation` returns early with **no warning** when
`config.cache` is unconfigured. A route can declare `revalidateTags`, return 200,
and invalidate nothing, forever, with zero signal. The package will not catch it;
its sibling `nutrition-staff` is still silently broken this way.

**So, before the first route declares a tag:** wire `cache` into
`configureNextBackendToolkit()`, and make a missing publisher URL or secret
announce itself loudly once at startup — distinguishing *fully unconfigured* from
*half-configured*. Otherwise the routes look built and the mechanism is dark.

**Bulk import never invalidates.** Import **stages** a catalog/inventory revision
and computes its rollups; an authenticated `POST /api/admin/catalog/publish`
flips it live and declares the tags. Maintaining a rollup in the database is not
the same act as publishing an invalidation.

## Backend conventions

- **Route factories only.** `createGetRoute`/`createPostRoute`/`createPutRoute`/
  `createDeleteRoute`. A route declares its DTOs, its `auth`, its
  `revalidateTags`, and its handler — nothing else.
- **Flow is DTO → validation → logic → repository.** Validation runs body →
  query → params in that fixed order.
- **PUT for updates, never PATCH.**
- **Auth is required by default**; a public route opts out with `auth: false`
  plus `export const dynamic = "force-dynamic"`.
- **Business logic lives in engines**, not route handlers. Pricing, promotions,
  purchasability, the variant matrix, shipping/lead time, the order state
  machine, returns, and **the storefront's dark-palette derivation** are pure
  modules with
  their own tests, and routes call them.
- **`_id` preserved, `__v` hidden, `id` virtual disabled. Uniqueness only via
  `@Unique()`.**
- **`@Unique()` builds single-field indexes only. There is no compound-unique
  primitive.** A compound invariant — "exactly one variant per axis combination"
  — is enforced by a derived, canonically-ordered `variantKey` carrying
  `@Unique()`.
- **A `@Unique()` is only a guarantee once the index is built.** Nothing waits
  for background index builds, so `ensureIndexes()` runs over all models before a
  connection is handed out and refuses to start if one is missing. Idempotency,
  customer email and order-number allocation all read a duplicate-key error as
  control flow; without the index they fail silently, not loudly.
- **A hand-written `@MongoField({ type: … })` is not checked against the
  TypeScript interface beside it.** Prefer a field helper; when a sub-schema must
  be hand-written, only a document round-trip test will catch a mismatch.
- **No Typegoose, no `@nestjs/mongoose`.** Class decorators only.
- **Default sort** is `{ createdAt: -1 }` with timestamps, else `{ _id: -1 }`.
- **Divide; never multiply by a reciprocal.** `.mul(rate).div(100)`, not
  `.mul(rate / 100)`.

## UI

- **Build on `@kira-joo/frontend-toolkit-tailwind`, do not compete with it.** If
  the toolkit ships it, use it; if it nearly ships it, improve the package rather
  than forking locally.
- **Import from subpath entry points, never the root barrel.**
- **Theme through `--ftk-*` roles.** No parallel token vocabulary. Only the roles
  that genuinely need to differ are redefined.
- **This app is light-only and English-only.** Verified precedent, not
  assumption: `restaurant-platform-staff` is `lang="en"` with no `next-intl`, no
  `src/i18n`, no locale routing and no dark ground.
- **But it renders Arabic *content*** — customer names, product titles,
  addresses. Every content field carries **`dir="auto"`** and is overflow-tested
  with long Arabic and with **mixed Arabic-plus-Latin** strings. Chrome is
  English; content is not. `dir="auto"` appears zero times in the restaurant
  precedent, so this is a new requirement, not an inherited pattern.
- **Mono is for Latin codes and figures only.** `IBM Plex Mono` has no Arabic
  coverage — Arabic set in it falls back silently and looks wrong.
- **Status colour is a fixed, learned vocabulary** — the same status reads
  identically on every surface. Colour is never the sole carrier of state; icon
  and text always accompany it.
- **Speed beats beauty** in operations mode. If a visual choice costs a tap, the
  visual choice loses. Touch targets ≥ 44px.
- **Motion is minimal and never costs time.** No scroll-reveal, no page
  transitions, no staggered lists, no animated counters.
- **Single UI language (English), bilingual content.** Arabic rendering and
  long-Arabic overflow are tested throughout.

## Verification

Run real servers against a real database, exercise real endpoints, read real
logs, measure in a real browser. Reasoning from source is not verification.

- `docker compose up -d` for the replica set. Transactions do not work without it.
- Browser QA at **375 / 768 / 1280 / 1440**, portrait and landscape on tablet,
  on the single ground.
- No horizontal page scroll at any width — a wide table's own scroll container
  may overflow locally, the page must not.
- Permission enforcement is tested **including the negative case**, which is the
  one that matters.

## Testing floor

Required, not aspirational. This app moves money and controls what customers can
buy:

- **Unit, non-negotiable:** every engine — pricing (tax modes, rounding),
  promotions (every condition, limit, stacking case), purchasability, the variant
  matrix (**including sparse combinations**), shipping and lead time, the order
  state machine (every allowed and forbidden transition), order-number
  allocation, returns, and **the storefront's dark-palette derivation with its
  contrast guarantees** — this console has one ground; the palette it derives is
  the storefront's.
- **Integration:** order placement in a real transaction *including the rollback
  path*, **oversell under contention on a last unit**, idempotent replay
  returning the original response, payment verify and reject with audit side
  effects, cache-tag invalidation firing exactly once on success and never on
  error, auth rotation and reuse detection.
- **API contract:** every storefront- and shop-facing response shape asserted,
  so a backend change that would break the storefront fails here.
- **Coverage sweeps:** every admin route declares a **non-empty** permission set;
  every shop route resolves an actor.

## Shared package changes

Before changing a `@kira-joo` package: map its real consumers **by import**, not
by `package.json`; preserve backward compatibility; run the package's own tests;
and verify in a real consumer via `docs/tasks/pack-local`, which packs **all**
local packages and installs them **all** — never a symlink, never a
`node_modules` swap. Revert the consumer's `package.json` and lockfile
afterwards; **a tarball path must never be committed.**

**Never publish unless explicitly asked** — per instance, not as a standing
authorization.

## Git

- Work on `staging`, branched from this repo's default branch.
- **Never merge to the default branch.**
- Never rewrite history or force push.
- Never commit `.env*`, a tarball dependency path, or a local-file lockfile entry.
- Inspect `git status` before any branch-switching or destructive operation.
- **Never commit or push unless explicitly asked.**

## Autonomy

Investigate, decide, implement, verify, then summarise. Proceed without asking on
bug fixes, refactors, tests, type and lint fixes, accessibility and responsive
fixes, state handling, and running builds, servers, or the local database.

Ask first for: destructive data operations, irreversible migrations, deleting
business data, breaking a package contract when an alternative exists, scope
expansion, deployment, package publication, and genuine product or business
decisions.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
