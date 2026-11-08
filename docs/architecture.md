# `mimora-staff` — architecture

> **Known stale (audited 2026-11-06 against the code — the code wins):** the module list omits `content/`,
> `invoices/`, `newsletter/`, `notifications/`, `storefront/` and `admin/`, and names a `server/inventory/` that does
> not exist (import batches live in `server/admin/catalog-import`); `styles/tokens.css` is light-only, not a
> two-ground layer; "derive every identifier from `store-platform`" is template text that conflicts with this
> repository's one-brand model (CLAUDE.md); `../../docs/...` links should read `../docs/...`.

**This document covers this repository's internals only.**

> **The cross-repo contract is `../../docs/store/04-cross-repo-architecture.md`,
> and it is authoritative.** The three API surfaces, the caching boundary, auth
> boundaries, shared domain vocabulary, money rules, transactions and the shared
> non-negotiables live there and are **not restated here.**
>
> That is deliberate: the restaurant pair keeps this document in both repos, and
> the two drifted from each other and from the code. **A shared contract
> duplicated in two places becomes two contracts.**

Reading order: workspace `CLAUDE.md` → `04-cross-repo-architecture.md` → this
repo's `CLAUDE.md` → this document → `MDS.md`.

---

## 1. Shape

```
src/
  app/                     backoffice UI (dynamic, staff session)
  app/api/storefront/**    public, cached by the consumer
  app/api/shop/**          customer, actor resolved in-handler
  app/api/admin/**         staff JWT + per-route permissions
  server/
    core/                  db, config, auth, serialization, revalidation
    catalog/               product, variant, category, collection, brand schemas
    inventory/             stock movements, import batches
    commerce/              cart, order, return, snapshots
    identity/              customer, staff, address, tokens
    fulfilment/            zones, pickup locations, hours
    shop/                  shop-actor resolution
    engines/               pure business logic, each with tests
  instrumentation.ts       reflect-metadata, boot-time config
  styles/tokens.css        the two-ground token layer (authoritative)
```

**Two products and a backend in one repository.** The `server/` tree is shared by
all three API surfaces and by nothing in the UI directly — UI talks to routes.

## 2. Boot order, and why it is load-bearing

1. **`reflect-metadata` first**, imported once in `instrumentation.ts`. Without
   the polyfill loaded before any decorator runs, decorators silently produce
   **empty schemas and DTOs that validate nothing** — a failure that looks like
   nothing at all.
2. **Global toolkit config once**, including the `cache` key.
3. **`ensureIndexes()` over every model before a connection is handed out**, and
   refuse to start if one is missing. A `@Unique()` is only a guarantee once the
   index is built, and Mongoose builds indexes in the background with nothing
   waiting. Idempotency, customer email and order-number allocation all read a
   duplicate-key error **as control flow** — without the index they fail
   silently, not loudly. A new model goes in the model registry, whose own test
   fails if you forget.

## 3. Engines

Pure modules, each independently unit-tested, listed in `MDS.md` §9. **Routes
call engines and add nothing.** Business logic never lives in a route handler and
is never duplicated in the storefront.

The `server/engines/` boundary is enforced by shape: an engine takes values and
returns values. It does not read config, reach the database, or know about HTTP.

## 4. Repositories

**Database-only.** They never make an external call, never publish a cache
invalidation, never send a notification. Those belong to the route-factory layer,
the only place that knows a real HTTP mutation happened — **a repository is also
called from migrations, scripts and bulk jobs**, none of which should trigger any
of that.

## 5. Cache invalidation

`revalidateTags` declared per route, published once after a successful handler,
delivered to the storefront's receiver.

**The mechanism is silent by default at the package layer** — `runRevalidation`
returns early with no warning when `config.cache` is unconfigured, and
`backend-toolkit-next` will not catch it. The application-level fix does not
propagate between sibling apps. So: `cache` is wired at boot, and a missing
publisher URL or secret **announces itself loudly once at startup in
production**, distinguishing *fully unconfigured* from *half-configured*.

**Cache tags are this application's own vocabulary and never move into a
package**, even though both apps share this backend. Duplicated deliberately,
contract-tested against the consumer.

**Bulk import never invalidates.** It stages a revision and computes rollups; an
authenticated `POST /api/admin/catalog/publish` flips it live and declares the
tags. Maintaining a rollup in the database is not the same act as publishing an
invalidation.

## 6. Actor resolution, and the guard it needs

The toolkit's global `auth` resolves **one audience per application** — here,
*staff*. So `/api/shop/**` declares `auth: false` and resolves its own actor:
`requireCustomer()` where an account is needed, `resolveShopActor()` where a
guest is legitimate. **A present-but-invalid token is an error, never a downgrade
to guest.**

Because `auth: false` therefore means two different things on two surfaces, two
coverage tests are part of the architecture, not an afterthought:

- **`/api/shop` route coverage** — fails unless every route resolves an actor or
  sits on a named, justified allowlist.
- **Admin route coverage** — fails unless every route declares a **non-empty**
  permissions array. Checking only for the presence of an `auth: {` block, as the
  restaurant version does, would pass `auth: { permissions: [] }`.

## 7. Private assets

Payment proofs and any other permission-gated file live in a **private** folder
and are served by a **short-lived signed URL minted per request, inside the same
handler that already checked the permission.**

**Where a file is stored is an implementation choice; who may read it is not.** An
unguessable URL is obscurity, not access control — URLs leak through history,
referrers, screenshots and forwarded messages. The restaurant pair implements
this correctly and the pattern is copied as-is.

## 8. Identifiers

**Every identifier is derived from `store-platform` at the first commit, never
renamed from the restaurant pair** — database name, mongoose cache key, cookie
names, asset folder paths. A `s/e-commerce/store-platform/` misses `ec_` and
`__ecommerceMongoose` entirely. A grep for the old forms is part of CI.
