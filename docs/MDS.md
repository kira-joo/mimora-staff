# `store-platform-staff` — Backoffice MDS

The master specification for the backoffice **and the single backend for both
applications**. The workspace `CLAUDE.md` outranks this document;
`../docs/store/04-cross-repo-architecture.md` governs anything that spans the two
repositories. This document is authoritative for everything inside this repo.

**Every unconfirmed line is marked `[ASSUMPTION]` in place.** Where it maps to a
registered decision the reference is given, e.g. `[ASSUMPTION → D-6]`; the
register is `../docs/store/03-decisions-and-assumptions.md`.

**Language:** English throughout — documents, code, comments and commit messages.

---

## 1. Product vision

The merchant's complete control surface over their own store. **That control
surface is what makes this platform sellable more than once**, so depth here is
the product, not polish.

The merchant is **data**. Catalog, inventory, content, theme, fulfilment,
payments, promotions, team — all of it is configuration fetched from this
backend. Changing the data produces a different store on the same codebase. There
is no `storeId`, no domain-based tenant resolution and no row-level tenant
scoping: **one deployment per merchant.**

This repository is two products and a backend:

| | Who | Optimised for |
|---|---|---|
| **Operations mode** — orders, fulfilment, inventory, returns | Warehouse, packing, support | Speed, glanceability, large targets, one-tap actions |
| **Management mode** — catalog, content, settings, reports | Owner, manager, merchandiser | Completeness, correctness, confidence before publishing |
| **The backend** | Both apps | Correctness above all |

It is **not** a dashboard of decorative cards, not an admin template, and **not a
smaller version of the storefront** — it must not inherit the storefront's visual
identity.

---

## 2. Staff personas and roles

| Persona | Lives in | Needs |
|---|---|---|
| **Owner** | Management | Everything. Pricing, margin, team, settings, theme |
| **Manager** | Both | Orders, inventory, returns, promotions, reports |
| **Merchandiser** | Management | Catalog, collections, content, imagery, SEO |
| **Fulfilment/packing** | Operations | Today's orders, pick lists, dispatch, nothing else |
| **Support** | Operations | Order lookup, customer history, returns, refunds |

**Roles are data, permissions are enumerated, and the permission engine lives in
the shared package** — this app supplies only its own permission-key vocabulary.
**Staff accounts are invite-only. No self-signup route exists**, and none may be
added.

`[ASSUMPTION]` these five roles ship as defaults and are editable. A merchant with
two employees should not have to design a permission model.

---

## 3. Information architecture

```
Today                     — the operational landing
Orders                    — board · list · detail · payments queue · returns
Catalog                   — products · variants · categories · collections · brands
                            size guides · reviews
Inventory                 — stock levels · low-stock · adjustments · import
Customers                 — list · detail · addresses · order history
Promotions                — discount codes · automatic promotions
Fulfilment                — zones · pickup locations · hours & exceptions · lead times
Content                   — home sections · pages · SEO defaults
Settings                  — store profile · brand & theme · payments · notifications · team
Activity                  — audit log
```

**Navigation is permission-filtered**, and a section a role cannot use is absent
rather than present-and-forbidden. **This hides UI only** — every route
independently enforces its own permission server-side.

---

## 4. Routes (UI)

All staff UI routes are dynamic and require a staff session. Authorization is
declared per route and enforced server-side; the client guard is cosmetic.

| Route | Permission | Notes |
|---|---|---|
| `/` | any | Today — the operational landing |
| `/orders` | `orders.read` | List, filterable |
| `/orders/board` | `orders.read` | The board |
| `/orders/[orderNumber]` | `orders.read` | Detail, timeline, actions |
| `/orders/payments` | `payments.verify` | The verification queue |
| `/returns` · `/returns/[id]` | `returns.read` | Return workflow |
| `/catalog/products` · `/[id]` | `catalog.read` / `catalog.write` | Product editor |
| `/catalog/products/[id]/variants` | `catalog.write` | **The variant matrix editor** |
| `/catalog/categories` · `/collections` · `/brands` · `/size-guides` | `catalog.write` | |
| `/catalog/reviews` | `reviews.moderate` | Moderation queue |
| `/inventory` · `/inventory/adjustments` · `/inventory/import` | `inventory.read` / `inventory.write` | |
| `/customers` · `/customers/[id]` | `customers.read` | |
| `/promotions` · `/promotions/[id]` | `promotions.write` | |
| `/fulfilment/zones` · `/pickup` · `/hours` | `fulfilment.write` | |
| `/content/*` | `content.write` | |
| `/settings/profile` · `/brand` · `/payments` · `/notifications` | `settings.write` | |
| `/settings/team` | `team.manage` | |
| `/activity` | `activity.read` | |
| `/login` · `/forgot-password` · `/reset-password` | public | See §19 and D-8 |

**Next 16 has `src/proxy.ts`, not `middleware.ts`.** It gates the authenticated
shell on cookie presence only — presence is not authentication, and every route
re-checks server-side.

---

## 5. Today — the operational landing

Not a dashboard. **The answer to "what needs me right now", in one screen.**

- Orders awaiting acceptance, with age.
- **Payment proofs awaiting verification**, with age — this is money sitting
  still.
- Orders due for dispatch today.
- Returns awaiting a decision.
- **Low-stock and out-of-stock variants** — a store's equivalent of a kitchen
  running out.
- Anything stuck: an order paid but unconfirmed, a proof older than its
  verification window.

Every tile is a filtered link, never a dead statistic. `[ASSUMPTION]` counts
refresh on an interval rather than by push; push arrives with notifications.

---

## 6. Orders

### 6.1 The board — the most important screen in operations

Columns by fulfilment stage, cards carrying order number, customer, item count,
total, payment state, age, and fulfilment mode. One-tap advance to the next
allowed state. Large targets, no hover-only affordances, readable at arm's
length.

**Order status and payment status are separate axes, always rendered as two
signals.** A COD order progresses while unpaid; a transfer order can be paid
before it is accepted. Collapsing them into one badge loses the distinction staff
act on.

### 6.2 Order list

Filter by status, payment state, mode, date range, zone, customer. Sort by
`createdAt` descending by default. Bulk actions where they are genuinely safe —
printing pick lists, exporting — and never for status transitions, which are
per-order decisions.

### 6.3 Order detail

The full immutable snapshot: lines with **SKU, option labels as shown at
purchase**, unit price, quantity, line total; pricing breakdown; fulfilment
snapshot; payment with destination snapshot and proof; the complete timeline with
actor, timestamp and reason; customer and address snapshot; notes.

**Nothing on this screen is re-derived from current catalog data.** Renaming a
product or changing a price must never alter a historical order.

### 6.4 Payments queue

For Wallet and InstaPay transfers: the uploaded proof, the expected amount, the
destination the customer was shown, and verify / reject-with-reason.

**The proof is a private asset.** It is served by a short-lived signed URL minted
per request, inside the same handler that already checked the permission. An
unguessable URL is obscurity, not access control — URLs leak through history,
referrers, screenshots and forwarded messages.

---

## 7. Order and payment lifecycles

> **Vocabulary reconciled (updated with the lifecycle work, #54).** The names in
> the diagram below are the plan's; the code's are: PLACED, CONFIRMED, PROCESSING,
> **SHIPPED** (= "dispatched"), **IN_TRANSIT** (optional, after SHIPPED),
> DELIVERED, READY_FOR_PICKUP, **COLLECTED** (a pickup's terminal state), CANCELLED.
> The authoritative map is
> `src/server/engines/order-state/order-state-machine.ts`. A delivery order may go
> SHIPPED → DELIVERED directly; a pickup order ends in COLLECTED and can never be
> DELIVERED. **Every "completed" rule** (reviews, the return window, the customer's
> cancel rights) asks `isCompletedStatus` — DELIVERED or COLLECTED — never
> `=== "DELIVERED"`. A pickup order completed as DELIVERED before COLLECTED existed
> stays valid and is treated as completed; there is no migration. The payment rule
> — a proof-required order cannot reach SHIPPED, IN_TRANSIT, READY_FOR_PICKUP,
> DELIVERED or COLLECTED until its payment is VERIFIED (`paymentAllowsTransition`) —
> is current and binding. Tracking (carrier + number, snapshotted on the order),
> invoices (`INV-000001`, allocated inside the placement transaction from their own
> counter, void-not-deleted on cancellation) and the printable packing slip and
> picking list are described in the code beside them (`fulfilment/carrier-tracking.ts`,
> `invoices/`, `engines/fulfilment-documents/`).

**The order lifecycle is measured in days, not minutes.** There is no
`PREPARING` (a kitchen state — `PROCESSING` is the code's equivalent); `READY_FOR_PICKUP` does exist, as a pickup order's step before `COLLECTED`.

```
PLACED → CONFIRMED → PROCESSING → DISPATCHED → IN_TRANSIT → DELIVERED
                                             ↘ READY_FOR_COLLECTION → COLLECTED
  ↘ CANCELLED (reason required)   ↘ REJECTED (reason required)
DELIVERED/COLLECTED → RETURN_REQUESTED → RETURN_APPROVED → RETURNED → REFUNDED
```

`[ASSUMPTION]` this exact vocabulary. The **mechanism** carries over from the
restaurant unchanged and is not an assumption: an explicit allowed-transitions
map, a reason-required set, terminal-state checks, and a timeline append on every
transition. **An invalid transition is a `ConflictError`, never a silent no-op.**

**Payment**, independently: `UNPAID → PROOF_SUBMITTED → VERIFIED` /
`PROOF_REJECTED`, plus `REFUND_PENDING → REFUNDED`. COD is `UNPAID` until
`COLLECTED_ON_DELIVERY`.

`[ASSUMPTION]` a transfer order auto-cancels if no proof arrives within a
configured window, and a rejected proof reopens submission rather than
cancelling.

---

## 8. Data model

Built with `backend-toolkit-mongoose` class decorators. **`_id` preserved, `__v`
hidden, the `id` virtual disabled, uniqueness only via `@Unique()`.** Default
sort `{ createdAt: -1 }` where timestamps exist, else `{ _id: -1 }`. No
Typegoose, no `@nestjs/mongoose`.

**Money is `Decimal` in major units at `MONEY_SCALE`, everywhere, including at
rest as BSON `Decimal128`.** Declared with `moneyField()`.

> **Never take `moneyField(...).type`.** It keeps the BSON type and silently
> discards the rounding setter and the reviving getter, so amounts store
> unrounded and hydrated reads hand back raw `Decimal128`.

> **A hand-written `@MongoField({ type: … })` is not checked against the
> TypeScript interface beside it.** The runtime schema and the interface are two
> independent declarations and nothing compares them — a field can be typed
> `Money` while the schema stores something else, with `tsc` silent. Prefer a
> field helper; when a sub-schema must be hand-written, **only a document
> round-trip test will catch a mismatch.**

**Currency is not part of an amount.** One deployment serves one currency;
`StoreProfile` carries it and `moneyView(currency, locale)` binds it for display.

**Numerals are per locale (D-10).** `ar` renders Arabic-Indic, `en` Western —
but **SKUs, order numbers, phone numbers and tracking numbers stay Western in
both**, because they are identifiers people copy and dictate. The backend emits
values; **formatting is one helper per content type on the consumer**, never a
per-component choice.

**Every identifier is re-derived for `store-platform`, never renamed from the
restaurant pair** — the database name, the mongoose cache key, cookie names and
asset folder paths. See §22.

### 8.1 Configuration singletons

| Entity | Key fields |
|---|---|
| **StoreProfile** | `name`/`tagline`/`description` (Localized), `logo`/`favicon`/`ogImage`/`heroMedia`, `brand` {primary, accent, surface, text, radiusScale, typographyChoice}, **`theme`** {`defaultGround`, `darkEnabled`, `allowVisitorChoice`, `tokenOverrides[]`}, `contact`, `socialLinks[]`, `currency`, `defaultLocale`, `supportedLocales[]`, `defaultSeo` |
| **FulfilmentSettings** | `deliveryEnabled`, `pickupEnabled`, `defaultDispatchLeadDays`, `cutoffTime`, `maxDaysAhead`, `orderMinimum` (Money), `shippingFeeMode`, `tax` {mode: INCLUDED\|ADDED, rate}, `allowGuestCheckout`, `customerCancelUntil`, `returnWindowDays` |
| **PaymentSettings** | `methods[]` — each {method, enabled, order, instructions (Localized), destination {accountName, number, handle}, requiresProof, autoCancelMinutes, verificationWindowMinutes}. **The destination is configuration and is never hardcoded.** |
| **InventorySettings** | `lowStockThreshold`, `defaultInventoryPolicy` (DENY \| CONTINUE_SELLING), `allowNegativeStock: false` — **not configurable to true** |
| **NotificationSettings** | per-event channel toggles, recipient roles. See §21 and D-8 |

`[ASSUMPTION → D-2]` `theme.tokenOverrides[]` accepts **brand fills only**, each
validated against both **storefront** grounds at write time and falling back to the derived
value on failure. `[ASSUMPTION]` `darkEnabled` is a merchant switch, consistent
with §4.5's every-capability-is-a-switch rule — this is §4.6's own labelled
assumption and needs confirming.

### 8.2 Catalog — the core divergence

| Entity | Key fields |
|---|---|
| **Product** | `name`/`description` (Localized, @Searchable), `slug` (@Unique), `category` (@Relation, @Filterable), `collections[]` (@Relation), `brand?` (@Relation), `images[]`, **`optionAxes[]`** {key, name (Localized), order, values[{key, name (Localized), order, swatchHex?}]}, `attributes[]` (facetable), `sizeGuide?` (@Relation), `lifecycle` (DRAFT \| PUBLISHED \| ARCHIVED), `publishAt?`, **`listing`** {minActivePrice, maxActivePrice, purchasableVariantCount, primaryImage}, `seoOverride?`, `order` |
| **Variant** | `product` (@Relation, @Filterable), **`sku` (@Unique)**, **`variantKey` (@Unique)**, `optionValues[]` {axisKey, valueKey}, `price` (Money), `compareAtPrice?` (Money), **`stock`** (integer ≥ 0), `inventoryPolicy`, `lowStockThreshold?`, `weightGrams?`, `dimensionsMm?` {l, w, h}, `unitOfMeasure` (EACH \| PACK \| BOX), `unitsPerSale`, `costPrice?` (Money), `images[]?`, `discontinued` |
| **Category** | `name`/`description` (Localized), `slug` (@Unique), `parent?` (@Relation), `image`, `order`, `active`, `seoOverride?` |
| **Collection** | `name`/`description` (Localized), `slug` (@Unique), `products[]` (@Relation), `image`, `rule?`, `order`, `active` |
| **Brand** | `name` (Localized), `slug` (@Unique), `logo`, `description?`, `order`, `active` |
| **SizeGuide** | `name` (Localized), `instructions` (Localized), `measurements` (structured table), `active` |
| **Review** | `product` (@Relation), `customer` (@Relation), `order?` (@Relation), `rating` 1–5, `title?`, `body`, `status` (PENDING \| PUBLISHED \| REJECTED), `moderatedBy?`, `moderatedAt?` |
| **Promotion** | `code?` (null ⇒ automatic), `name`/`description` (Localized), `type` (PERCENT \| FIXED \| FREE_SHIPPING), `value`, `conditions` {minSubtotal, categories[], collections[], products[], variants[], firstOrderOnly, startsAt, endsAt}, `limits` {totalUses, perCustomerUses}, `stackable`, `active` |

#### Why `Variant` is its own collection, not an embedded array

**Forced by evidence, not preference.** `@Unique()` builds **single-field indexes
only** — it is the sole place unique indexes are created, so that it can be
soft-delete-aware and sparse-aware. An embedded `variants[].sku` therefore
**cannot be enforced at all**, and a unique multikey index is not a sound way to
enforce uniqueness among sibling array elements.

Separately: separate documents make the stock guard narrowly contended
(`{_id, stock: {$gte: qty}}` + `$inc`), where embedded variants would make every
purchase of *any* variant contend on the same product document; and a product
carrying galleries, localized content, facets, SEO and hundreds of variants
approaches the 16 MB document limit while forcing a full parent rewrite on every
stock change.

#### `variantKey` — a compound invariant without a compound primitive

"Exactly one variant per product per axis combination" is a **compound**
invariant, and there is no compound-unique primitive. So it is enforced by a
**derived, canonically-ordered, globally-unique** key:

```
<productId>|colour=red|size=m        // axes sorted by key, values normalised
```

carrying `@Unique()`. **Axis and value keys are immutable identifiers**; display
names are localized and freely editable. Every variant must carry exactly one
value for every axis its product defines — no more, no fewer — validated in
application code, because `@Relation` is a population aid and not a constraint.

#### A variant owns its price. There is no delta.

The restaurant computes `unitPrice = basePrice + Σ priceDelta`. **That model is
deleted, not renamed.** A T-shirt in XL/black is not generally
`base + delta_XL + delta_black`, and modelling it that way gives one price two
sources of truth. **`Product` carries no price and no stock.**

#### The matrix is sparse

Not every axis combination exists. **A combination that does not exist and a
combination that exists with zero stock are different states** and must never be
conflated — conflating them produces either phantom inventory or unsellable
products.

### 8.3 Inventory

| Entity | Key fields |
|---|---|
| **StockMovement** | `variant` (@Relation), `delta`, `reason` (SALE \| RETURN \| ADJUSTMENT \| RECEIPT \| DAMAGE), `order?`, `actor`, `note?`, `at` |
| **CatalogImportBatch** | `status` (STAGED \| PUBLISHED \| DISCARDED), `rows`, `errors[]`, `stagedBy`, `publishedBy?`, `publishedAt?` |

**`stock` means sellable on-hand units — one unambiguous meaning.** Returns,
damage and receiving each record their own `StockMovement` rather than all
mutating one counter with incompatible semantics. `Variant.stock` remains the
authoritative live figure; movements are the audit trail.

`[ASSUMPTION]` movements are recorded from v1 but a full double-entry inventory
ledger and valuation are v2.

### 8.4 Commerce

| Entity | Key fields |
|---|---|
| **Cart** | `cartToken?` (guest) \| `customer` (@Relation), `lines[]`, `fulfilmentDraft`, `appliedPromotionCode?`, `expiresAt`. **Totals are never stored** — computed on every read so they cannot go stale |
| **CartLine** | **`lineId`** (stable), `variant` (@Relation), `quantity` |
| **Order** | `orderNumber` (@Unique, sequence), **`termsVersionAccepted` + `acceptedAt`** (D-13 — a store that cannot show *which* terms a customer agreed to has not taken consent), `customer?` \| `guestContact`, `status`, `paymentStatus`, `fulfilment` {mode, address snapshot \| location snapshot, zone snapshot, dispatchBy, promisedWindow}, `lines[]` (**full immutable snapshot**), `pricing` {subtotal, discount, shippingFee, tax, total} (Money), `payment` {method, destinationSnapshot, proofAsset?, submittedAt?, verifiedBy?, verifiedAt?, rejectionReason?}, `promotionSnapshot?`, `timeline[]`, `idempotencyKey`, `accessToken` (guest tracking) |
| **OrderLine** | `productId`, `variantId`, **`sku`**, `productName` (snapshot), `optionLabels[]` (snapshot, as shown), `unitPrice`, `compareAtPrice?`, `quantity`, `lineTotal`, `taxTreatment`, `weightGrams?`, **`unitCost?`** |
| **Return** | `order` (@Relation), `lines[]`, `status`, `reason`, `requestedAt`, `decidedBy?`, `refund` {amount, status, at?} |
| **ReturnLine** | `orderLineId`, `quantity`, `reason`, `condition`, `disposition` (RESTOCK \| DISCARD) |
| **Customer** | `name`, **`phone` (@Unique, E.164-normalised)** — the login identifier, **`email?` (@Unique sparse)** — optional, `passwordHash` (select: false), `phoneVerified` / `emailVerified` (`emailVerified` set by the emailed verification link when mail is configured; `phoneVerified` stays `false` — no SMS transport exists), `tokenVersion`, `status`, `marketingConsent`, `defaultAddress`. See **D-9** |
| **Address** | `customer`, `label`, `recipientName`, `phone`, `zone`, `street`, `building`, `floor?`, `apartment?`, `landmark?`, `isDefault` |
| **Wishlist** | `customer` (@Relation), `product` (@Relation) |
| **StaffRefreshToken** | `subjectId`, `tokenHash` (@Unique), `familyId`, `expiresAt`, `revokedAt?`, `replacedByHash?` — own collection, no audience field |
| **CustomerRefreshToken** | Same shape as `StaffRefreshToken` — own collection, no audience field |
| **StaffUser** | `name`, `email` (@Unique), `passwordHash` (select: false), `roles[]`, `tokenVersion`, `status`, `lastLoginAt` |
| **ActivityLog** | `actor`, `action`, `entityType`, `entityId`, `before?`, `after?`, `at`, `ip?` |
| **IdempotencyRecord** | `key` (@Unique), `scope`, `requestHash`, `responseBody`, `statusCode`, `expiresAt` |

**Two refresh-token models, not one with a discriminator (D-14, 2026-09-18).**
`restaurant-platform-staff`'s `refresh_tokens` collection shares one schema
between `CUSTOMER` and `STAFF`, disambiguated by a `TokenAudience` field — this
document previously described the same shape and that was a contradiction of
the decision below, not a second sanctioned pattern. **The collection itself is
the audience boundary here**: `StaffRefreshToken` and `CustomerRefreshToken` are
separate collections, both instantiated from the same `createRefreshTokenSchema()`
factory promoted into `backend-toolkit-mongoose` (Phase 1), with no audience
field on either. See `../../docs/authentication-architecture.md` § "Decided —
refresh tokens are per-audience collections" and
`../../docs/store/03-decisions-and-assumptions.md` D-14.

**Snapshot discipline.** An order stores what was purchased, not references that
drift — **including the SKU**, which the restaurant's order line lacks entirely.
A receipt and every return flow need to know exactly which variant was bought.
The payment destination, the shipping zone and fee, and the applied promotion are
snapshotted for the same reason.

`[ASSUMPTION → D-5]` `CartLine` carries no customisation field in v1, so lines
merge on `variantId` alone. **`lineId` exists from day one regardless**, so
adding a configuration dimension later does not require re-identifying live
carts.

### 8.5 Fulfilment

| Entity | Key fields |
|---|---|
| **DeliveryZone** | `name` (Localized), `areas[]`, `fee` (Money), `minimumOrder` (Money), **`leadDays`**, `active`, `order` |
| **PickupLocation** | `name`/`address` (Localized), `coordinates`, `phone`, `hoursOverride`, `active`, `order` |
| **OperatingHours** | `weekly[]` {weekday, ranges[{open, close}]}, `exceptions[]` {date, closed, ranges[]} |

`[ASSUMPTION]` named areas rather than polygons in v1 — simpler to configure and
to explain to a customer.

---

## 9. Server-side engines

Pure, independently unit-tested modules. **Business logic lives here, not in
route handlers, and is never duplicated in the storefront.**

| Engine | Responsibility |
|---|---|
| **Pricing** | Resolve each line's absolute variant price; subtotal; discount; shipping fee from zone; tax by mode; total. The single source of truth for money |
| **Promotion** | Eligibility, condition evaluation, usage limits, stacking |
| **Purchasability** | Product published, variant active and not discontinued, stock sufficient under the inventory policy |
| **Variant matrix** | Emit the compact purchasable matrix; resolve selectable axis values for a partial selection |
| **Shipping & lead time** | Zone resolution, fee, minimum, dispatch lead days, promised window |
| **Order state machine** | Allowed transitions, reason-required set, terminal checks, timeline append |
| **Order placement** | The transactional orchestration (§10) |
| **Order number** | Gap-tolerant sequence, allocated inside the placement transaction |
| **Returns** | Eligibility window, per-line quantities, disposition, refund state |
| **Theme derivation** | Derive **the storefront's** dark palette from brand input, **with contrast guarantees** (§20). This console has one ground; the palette it derives is not its own |

### The variant matrix, precisely

**Availability is existential, not per-axis.** An axis value is selectable iff
**at least one** variant exists that is purchasable, carries that value, and
matches every other current selection.

> "Size M exists" and "red exists" does **not** imply "M in red exists".

**Never materialise independent per-axis availability arrays and treat them as
conjunction** — on a sparse matrix they produce false positives, and the customer
picks a combination the UI offered and add-to-cart fails.

The engine emits `{variantId, optionValues, price, compareAtPrice?,
purchasable}` — **never admin inventory detail**. The client indexes it and
intersects candidate sets, so a selector click costs no round trip. **The server
re-validates at add-to-cart and at placement regardless.**

`[ASSUMPTION]` a hard cap of **three** option axes in v1. Beyond that the
problem is combinatorial rather than merely slower, and four generic axes means
the product needs a configurator rather than a variant selector.

---

## 10. Order placement and oversell prevention

**One `withTransaction`**: re-price authoritatively, re-check purchasability,
**decrement per-variant stock**, allocate the order number, snapshot everything,
create the order, clear the cart — **or none of it**. Use `withTransaction` from
`backend-toolkit-mongoose`; never `startSession`/`commitTransaction`/
`abortTransaction` directly. The session propagates ambiently, so no repository
call and no helper takes a `session` parameter. **This requires a replica set.**

**The guard.** The quantity predicate goes **inside** the update filter:

```
findOneAndUpdate(
  { _id: variantId, discontinued: false, stock: { $gte: quantity } },
  { $inc: { stock: -quantity } }
)
```

A read-then-write is not a guard. A non-match aborts the transaction.

- **A retry does not double-decrement** — the failed attempt rolls back and the
  callback re-runs from its initial state. That is exactly why **the callback
  must be idempotent**.
- **No parallel database work in one session**, so a multi-line order decrements
  **sequentially**. **Aggregate duplicate variants and decrement in canonical
  sorted order** to avoid avoidable deadlock pressure.
- A hot last unit serialises purchases and may exhaust the retry budget,
  surfacing as a retryable service-unavailable. **That is the correct outcome and
  better than overselling.**
- **No external I/O inside the transaction.** Uploads happen before; cleanup in
  `onAbort`; notifications and cache invalidation in `onCommit`.
- **Do not swallow an error**; if you must, call `tx.markRollbackOnly(error)` in
  the same catch block. A transaction that writes returns `tx.complete(value)`.

**No reservations or holds in v1.**

**Every write that can move money is idempotent** by a client-supplied
`Idempotency-Key`, **scoped by route and actor before uniqueness** — a raw
globally-unique client key is operationally awkward and a cross-user replay
hazard.

---

## 11. API requirements

Route factories throughout. A route declares only its DTOs, its `auth`, its
`revalidateTags`, and its handler. Flow is **DTO → validation → logic →
repository**, validation running **body → query → params** in that fixed
sequential order. **PUT for updates, never PATCH.**

### 11.1 `/api/storefront/**` — public, cached, `auth: false`

`GET` store-profile · theme · fulfilment-settings · payment-methods *(display
fields only — never a secret, never an internal note)* · operating-hours ·
delivery-zones · pickup-locations · categories · collections · brands · products
· products/[slug] *(including the purchasable variant matrix)* · facets ·
size-guides/[id] · reviews/[productId] · promotions/active · pages/[slug] ·
search

**Every one declares `auth: false` AND `export const dynamic =
"force-dynamic"`.** A missing second half is the silent half. Caching is handled
by the consumer's tags.

### 11.2 `/api/shop/**` — customer, never cached

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/signup`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification` |
| Cart | `GET /cart`, `POST /cart/lines`, `PUT /cart/lines/[lineId]`, `DELETE /cart/lines/[lineId]`, `PUT /cart/fulfilment`, `POST`/`DELETE /cart/promotion` |
| Quote | `POST /quote` — authoritative pricing for the current cart + fulfilment |
| Orders | `POST /orders` *(idempotent)*, `GET /orders`, `GET /orders/[orderNumber]`, `POST /orders/[orderNumber]/cancel` |
| Payment | `POST`/`PUT /orders/[orderNumber]/payment-proof` *(idempotent, multipart)* |
| Returns | `POST /returns`, `GET /returns`, `GET /returns/[id]` |
| Reviews | `POST /reviews`, `GET /reviews/mine` |
| Account | `GET`/`PUT /profile`, `PUT /profile/password`, CRUD `/addresses`, CRUD `/wishlist` |

**These declare `auth: false`, and that is deliberate.** The toolkit's global
`auth` resolves **one audience per application**, and here that audience is
*staff* — a shop route declaring `auth: true` would authenticate a customer
against `staffusers`, the exact cross-audience failure the separation exists to
prevent. So the shop surface resolves its own actor:

- **`requireCustomer(request)`** — routes needing an account.
- **`resolveShopActor(request)`** — customer **or** guest, because guest checkout
  is a product requirement and an absent token is a normal outcome.
- **A present-but-invalid token is an error, never a downgrade to guest.**
  Downgrading hands someone a fresh empty cart and reads as a storefront bug
  rather than an expiry.

**`[ASSUMPTION → D-1]` no CORS on this surface.** All shop traffic arrives
server-to-server from the storefront's own route handlers, and server-to-server
requests are not subject to CORS. Adding it later is additive; carrying
unexercised security machinery is how a misconfiguration goes unnoticed.

### 11.3 `/api/admin/**` — staff JWT + permissions, never cached

Full CRUD for every entity in §8, plus the action endpoints: order status
transitions, cancel, reject, payment verify/reject/refund, return approve/reject/
receive, stock adjust, bulk stock adjust, **`POST /catalog/publish`**, variant
bulk upsert, product reorder, review moderate, permission sync, staff invite,
theme preview and save.

Each declares its own `auth: {permissions: [...]}` and its `revalidateTags` where
a change must reach the storefront.

### 11.4 The two coverage tests — required, not optional

`auth: false` means two different things on two surfaces, and the difference
between "public by design" and "requires a customer" is carried by **nothing but
a function call inside the handler**. The restaurant pair has three guards on the
admin surface and **none** on the shop surface.

1. **A `/api/shop` route-coverage test** failing unless every route calls
   `requireCustomer`, calls `resolveShopActor`, or sits on a named, justified
   allowlist.
2. **An admin coverage test asserting a NON-EMPTY permissions array** — the
   restaurant version checks only for the presence of an `auth: {` block, so
   `auth: { permissions: [] }` would pass it.

Both ship **with the first route of their surface**, not at the end.

### 11.5 Cross-cutting

- **Cache invalidation** is declarative via `revalidateTags`, published once
  after a successful handler, delivered to the storefront's receiving route.
  **Triggered only by a real HTTP mutation — never from a migration, script,
  test or bulk operation.**
- **Rate limiting** on login, signup, password reset, verification resend,
  promotion validation, review submission and order placement. **By IP *and* by
  account**, with state **in the database** — per-process memory makes the
  effective limit the configured limit times the instance count, which is not a
  limit.
- **Errors** use the shared typed hierarchy mapped to one shape, with field-level
  validation errors.

---

## 12. Cache invalidation — the mechanism is silent by default

`backend-toolkit-next`'s `runRevalidation` returns early with **no warning** when
`config.cache` is unconfigured. Its own doc-comment says so. **A route can
declare `revalidateTags`, return 200, and invalidate nothing, forever, with zero
signal.** The package will not catch it, and the application-level fix does not
propagate — its sibling `nutrition-staff` is still silently broken this way.

**Therefore, before the first route declares a tag:** wire `cache` into
`configureNextBackendToolkit()`, and make a missing publisher URL or secret
**announce itself loudly once at startup in production**, distinguishing *fully
unconfigured* from *half-configured*.

**Cache tags are this application's own vocabulary** — `PRODUCTS`, `VARIANTS`,
`CATEGORIES`, `COLLECTIONS`, `BRANDS`, `REVIEWS`, `STORE_PROFILE`, `THEME`,
`CONTENT`, `FULFILMENT`, `PROMOTIONS`. **They never move into a shared package**,
even though both apps share this backend. Duplicated deliberately, and
contract-tested against the consumer.

### Bulk import never invalidates

Import **stages** a `CatalogImportBatch` and computes its rollups. An
authenticated **`POST /api/admin/catalog/publish`** flips the staged revision
live and declares the tags. A script or worker **never** mutates live catalog
data and never publishes an invalidation.

**Maintaining a rollup in the database is not the same act as publishing a cache
invalidation.** Until publication, previously cached catalog data is
*intentionally* live. This preserves the constitution's rule rather than adding a
hidden exception to it.

### Rollups

`Product.listing.minActivePrice`, `maxActivePrice`, `purchasableVariantCount` and
`primaryImage` are **materialised and maintained transactionally with the variant
write that changes them** — variant create/delete, active or discontinued
change, price change, stock crossing zero, or product lifecycle change.

`purchasableVariantCount` is a **count, not a boolean**, so a sale taking one
variant to zero decrements it correctly and replenishment reverses it. A boolean
cannot be maintained correctly under concurrent writes. This makes a popular
product's rollup a contention point — a real and accepted v1 tradeoff.

---

## 13. Catalog management

Product editor: localized content, slug, category, collections, brand, imagery,
option axes, attributes, size guide, SEO, lifecycle. **Lifecycle is
`draft`/`published`/`archived`, not a boolean** — a merchant needs to prepare a
product without exposing it, and archiving must not break historical orders.

### The variant matrix editor — the hardest screen in the product

A grid of per-variant **SKU, price, stock** across the product's axes.
Requirements:

- **A combination that does not exist must be visibly distinct from one that
  exists with zero stock.** These are different states; conflating them produces
  phantom inventory or unsellable products.
- Generate the full matrix from the axes, then let the merchant **remove**
  combinations that do not exist.
- **A duplicate axis combination must be impossible to express**, not rejected on
  save — `variantKey` enforces it at the database, and the UI must not let a user
  reach that error.
- Bulk edit down a column (all size-M rows), bulk price change, bulk stock set.
- SKU uniqueness surfaced inline, before save.
- Renaming an axis **display name** must be obviously safe; changing an axis
  **key** must be obviously destructive — and `[ASSUMPTION]` keys are not
  editable at all once variants exist.

---

## 14. Inventory management

Stock levels per variant, filterable by product, category, low-stock and
out-of-stock. Adjustments record a reason and an actor. CSV import **stages**
(§12). Low-stock threshold per variant with a settings default.

`[ASSUMPTION]` `inventoryPolicy` defaults to `DENY` for every merchant, and
`CONTINUE_SELLING` (backorder) is a per-variant opt-in whose customer-facing
messaging is v1 but whose partial-fulfilment workflow is v2.

---

## 15. Customers, promotions, reviews, returns

- **Customers** — list, detail, addresses, order history, wishlist, review
  history, status. **No password is ever visible or settable by staff.**
- **Promotions** — discount codes and automatic promotions, with conditions,
  limits and stacking. Usage is counted transactionally at placement.
- **Reviews** — **a verified purchase is required**: a review can only be left by
  a customer with a **delivered** order containing that product. **Confirmed by
  the owner**, and it is a structural control rather than a moderation one — it
  kills fake reviews and spam before they exist, which matters because the
  merchant is the one moderating. Staff moderation still exists for what gets
  through: a queue of pending / published / rejected.

  The enforcement lives in the engine, not the UI: `POST /api/shop/reviews`
  rejects unless an order exists for this customer, containing this product, in a
  delivered state. **One review per customer per product** `[ASSUMPTION]`,
  editable rather than duplicated.
- **Returns** — request, approve/reject with reason, receive with per-line
  condition and disposition, refund. **Per-line quantities are validated against
  the immutable order-line snapshot**, never against current catalog data.
  Restocking a returned line writes a `StockMovement` with reason `RETURN`.
  Exchanges are **v2**, modelled as a return plus a new order — never as
  "change the variant on the original order", because inventory, price
  difference, payment and shipment all diverge.

---

## 15a. Operational reports — exactly three

**Confirmed by the owner. Three, not twelve** — three that get used beat twelve
that do not.

| Report | Contents | Why this one |
|---|---|---|
| **Sales summary** | Daily and monthly: revenue, order count, average order value | The baseline question a merchant asks every morning |
| **Stock health by variant** | Out of stock and running low, **at size-and-colour level, not product level** | **In apparel the size runs out, not the product.** This is the report that drives reordering, and a product-level version of it would be useless — it is the clearest operational argument for the variant being the real unit |
| **Payment verification queue, with ageing** | Transfers awaiting review, and how long each has waited | Manual verification means money and orders sit here. **The ageing is the point**, not the count — a queue of 3 that has waited two days is worse than a queue of 20 from this morning |

**Explicitly v2:** best/worst sellers, returns by reason, fulfilment ageing. The
first needs data to accumulate before it says anything; the others need volume to
be worth reading.

**Reports read; they never write, and they never invalidate a cache.** They are
`/api/admin/**` reads with their own permission, and they must not become a
back door into mutating state.

`[ASSUMPTION]` all three are screen-first with CSV export, since export is
already a v1 capability (§2.10 of the consolidated plan).

---

## 16. Fulfilment configuration — every capability is a switch

Zones with fee, minimum and lead days; pickup locations; operating days, hours
and exceptions; dispatch cutoff and lead times. **And the capability switches
themselves**: a merchant can turn pickup off entirely and be delivery-only, or
turn delivery off and be collection-only.

**The storefront must render correctly for every combination, including nothing
enabled at all.** The restaurant's storefront handles single-capability cases
well — off modes are filtered out of the array entirely rather than disabled, and
a single remaining mode is auto-applied silently — but with **both** off it
renders a bare section header with nothing beneath it. **That degenerate case is
a first-class designed state here, and it is tested.**

`[ASSUMPTION]` a merchant with no fulfilment capability enabled cannot accept
orders at all, and the backoffice says so prominently rather than letting the
storefront fail quietly.

---

## 17. Storefront content management

Home sections, featured collections, offer copy, pages (about, contact, legal),
SEO defaults. All localized, all cache-tagged.

---

## 18. Team and permissions

Staff list, invite, role assignment, deactivate. Roles carry enumerated
permissions.

- **Invite-only. No self-signup route exists, and none may be added.**
- **Authorization always runs server-side.** A permission guard hides UI; it
  never grants access.
- **Every `/api/admin/**` route declares its own permission requirement**, and
  the coverage test (§11.4) requires it to be non-empty.
- Deactivation takes effect on the **very next request** — `resolveUser` returns
  null.

---

## 19. Authentication (staff)

Governed by `../docs/authentication-architecture.md`. In summary: tokens in
HttpOnly cookies set by this backend; `Secure` outside development;
`SameSite=Lax`; explicit `path`, re-sent identically on clear — a mismatch leaves
the cookie in place and the user appears to log out while staying
authenticated. Access tokens short-lived; refresh tokens rotate with **reuse
detection revoking the whole family**; **only hashes stored**.

**Two audiences share nothing** — not a secret, cookie name, collection,
redirect or refresh audience. **Every one of these identifiers is re-derived for
`store-platform`**, never inherited.

**Login reports one message for every failure** and runs the password comparison
even when no account exists, against a decoy hash **generated from the real
hasher** — a hardcoded constant that fails to parse would make the
unknown-account path dramatically faster and silently reinstate the enumeration
oracle.

**Logout is `auth: false` on purpose:** it must work when the token has already
expired or been revoked.

`[ASSUMPTION → D-8]` staff password reset is built and gated. **There is no mail
transport in the restaurant pair**, and its reset route already mints a token,
hashes it and **discards the plaintext** — correctly, since returning it would
hand out account takeover — leaving no recovery path. Here the flow is built and
the capability **announces itself loudly as OFF at startup** rather than failing
silently.

---

## 20. Theming

`../docs/store/00-kickoff-brief.md` §4.6 governs. **This console is light-only
and English-only** — verified precedent, and the brief has withdrawn the line
that once said otherwise. What follows concerns the *storefront's* theme, which
staff configure from inside this app. The console having one ground says nothing
about the storefront having two.

Staff configure the merchant's brand colours for the storefront from inside this
app. **The derivation is a pure, unit-tested engine function** — it decides
legibility for every store this platform is ever sold to, so it belongs with the
money engines in the testing floor.

**What the UI must prevent, not detect.** Two recorded failures define the shape:

1. An operator supplied both a fill and its ink, with nothing checking the pair.
   `#6B8F71` on white measures **3.63:1** and failed **16 nodes across 8 routes**
   the moment a second store rendered — the first store's values happened to
   pass, which is why it never surfaced. Validating the supplied pair was
   rejected as weaker: it leaves existing data broken, puts the burden on the
   person least equipped to carry it, and turns a rendering guarantee into a
   data-entry rule the next import bypasses. **So the ink is derived.**
2. A brand `soft` **surface** hex painted a cart notice cream-on-cream on the
   dark ground, because **a surface is ground-dependent** and a single value
   emitted inline wins over *both* ground blocks. Every contrast pair still
   passed, because the failing pair was one the brand had substituted at runtime.

**Therefore `[ASSUMPTION → D-2]`:** override is permitted for **brand fills
only**, validated against **both storefront grounds** at write time, falling back to the
derived value on failure. **Never** a ground-dependent surface; **never** text,
border or state colours, which carry the measured ratios.

The staff theme screen previews **all four storefront combinations** —
light/`ar`, light/`en`, dark/`ar`, dark/`en` — and shows the measured ratio for
each pair it is about to write. It previews a product it is not itself.

---

## 21. Notifications

**Answered (D-8): there is no email provider yet, and one is coming later.**

*(Updated 2026-10-24: the provider arrived as the planned one adapter — Nodemailer over SMTP env vars, `src/server/core/mail/`. With mail unconfigured the no-op below is still what runs, announced OFF at boot. Every rule in this section still holds; see `docs/configuration.md` for the variables.)*

In-app notifications are v1. Email is **not built as a feature and not designed
out** — instead there is **one outbound-notification interface** with a **no-op
implementation** that logs every message it would have sent and **announces
itself loudly as OFF once at startup in production**, per the constitution's rule
on a capability configured OFF.

**No flow may depend on email to complete.** Order confirmation, password reset
and payment-proof verification all work without it. When a provider arrives it
should be **one adapter, not a refactor** — which is the entire reason the seam
exists now rather than later.

**Do not silently swallow the absence.** A no-op that logs nothing is
indistinguishable from a transport that works. Events: order placed, proof submitted, proof
verification overdue, order stuck, low stock, out of stock, return requested.
Per-event channel toggles and recipient roles.

**Notifications are dispatched in `onCommit`, never inside a transaction.**

---

## 22. Identifiers — re-derived, never renamed

The restaurant pair's old name is baked into **running code**, not just prose:
the Mongo database name (`"e-commerce"`), the global mongoose cache key
(`__ecommerceMongoose`), cookie names (`ec_staff_session`, `ec_customer_session`)
and five Cloudinary folder paths.

**A naive `s/e-commerce/store-platform/` misses `ec_` and `__ecommerceMongoose`
entirely.** A copy-and-rename would ship a store whose database is named
`e-commerce`, whose cookies collide with another product's, and whose uploads
land in someone else's folder. **Every identifier here is derived from
`store-platform` from the first commit**, and a grep for the old forms is part of
CI.

---

## 23. Error, empty, and loading states

States are deliverables, not fallbacks. Every list has a genuine empty state that
says what to do next; every mutation has a pending state that prevents double
submission; every failure maps to a specific message, and **validation errors map
to individual form fields**. A screen that says only "Something went wrong" is a
defect.

**Distinguish "no data yet" from "no data matching this filter"** — they need
different copy and different actions.

---

## 24. Responsive behaviour and accessibility

Operations mode is used on tablets in a warehouse and phones on the move.
**375 / 768 / 1280 / 1440**, portrait and landscape on tablet, on the single
ground.
No horizontal **page** scroll at any width — a wide table's own container may
scroll; the page must not.

**Touch targets ≥ 44px.** Full keyboard operability; visible focus everywhere;
focus trapped in modals and restored on close; one `h1` per page; real
`<button>`/`<a>` elements; every input labelled with errors linked by
`aria-describedby` and announced; live regions for status changes.
**WCAG 2.1 AA**, ratios recorded in `design-system.md`.
`prefers-reduced-motion` honoured with a genuine non-animated path.

**Single UI language (English), bilingual content.** Every field rendering
merchant or customer content carries **`dir="auto"`**; long-Arabic overflow and
**mixed Arabic-plus-Latin** strings are tested in tables, cards and truncated
cells. Mixed-direction content is the real hazard, not Arabic alone.

---

## 25. UX principles and visual direction

**Speed beats beauty in operations mode.** If a visual choice costs a tap, the
visual choice loses.

**Status colour is a fixed, learned vocabulary** — the same status reads
identically on the board, in a list, on detail and in the timeline. **Colour is
never the sole carrier of state**; icon and text always accompany it.

**Motion is minimal and never costs time.** No scroll-reveal, no page
transitions, no staggered lists, no animated counters.

Full direction and tokens in `design-system.md`. **The token file is
authoritative; that document must be kept honest against it** — both restaurant
design-system documents drifted from their token files, one describing a
superseded palette and one listing four statuses where the code has eight.

---

## 26. QA requirements

**This app moves money and controls what customers can buy. Required, not
aspirational.**

- **Unit:** every engine, with edge cases — pricing (every tax mode, rounding at
  the boundary only), promotions (every condition, limit, stacking case),
  purchasability, **the variant matrix including sparse combinations**, shipping
  and lead time, the order state machine (every allowed **and forbidden**
  transition), order-number allocation, returns, **and the theme derivation
  across a sweep of brand inputs including awkward mid-tones**.
- **A test proving the independent-per-axis shortcut would produce a false
  positive**, so the correct existential implementation is pinned rather than
  incidental.
- **Integration:** order placement in a real transaction **including the rollback
  path**, asserting no collection retains partial state; **oversell under
  contention on a last unit**; idempotent replay returning the original response;
  payment verify and reject with audit side effects; cache-tag invalidation
  firing exactly once on success and never on error; auth rotation and reuse
  detection.
- **Round-trip tests for every hand-written sub-schema** (§8).
- **Permission enforcement including the negative case** — the one that matters.
  Each case run twice: once with exactly the required permission, once with every
  *other* permission.
- **Both coverage sweeps** (§11.4), each observed to fail when deliberately
  broken.
- **API contract:** every storefront- and shop-facing response shape asserted,
  so a backend change that would break the storefront fails here.
- **The second-store fixture**, differing in currency, zones, payment methods,
  enabled capabilities **and theme configuration**, exercised in CI. A derived
  dark palette tested against one brand's colours has not been tested.

**And confirm the guards can fail.** *A test that cannot fail proves nothing.*
Break each one deliberately — the token guard, both contrast gates, both coverage
sweeps, and the cache announcement — and confirm it goes red.
