# Bulk catalog import

Add or update many products from one CSV. The file is **staged** first — read, validated and stored, with every
problem listed against its line — and only an explicit **publish** applies it. Staging changes nothing live and
invalidates no cache.

Code: `src/server/admin/catalog-import/`. Screens: Catalog → Bulk import. Routes: `/api/admin/catalog-imports`.

## The flow

| Step | Route | Permission | What happens |
|---|---|---|---|
| Stage | `POST /api/admin/catalog-imports` (multipart, field `file`) | `CatalogImportBatch.create` | Parses and validates every row against the file and the catalog as it is now. Stores a `STAGED` batch with the parsed products, `rowErrors`, `warnings` and a `summary`. **No product, variant, stock figure or movement is written; no tag is declared.** |
| Preview | `GET /api/admin/catalog-imports/:id`, `GET …` (list) | `CatalogImportBatch.readOne` / `.read` | The staged rows, each problem with its CSV line and column. |
| Discard | `DELETE /api/admin/catalog-imports/:id` | `CatalogImportBatch.delete` | `STAGED → DISCARDED`. |
| Publish | `PUT /api/admin/catalog-imports/:id/publish` | `Catalog.publish` | Applies the batch in **one transaction**, then the route declares `PRODUCTS`. |

Staging needs no publish power and publishing needs no staging power: a merchandiser can prepare a batch an owner approves.

A batch with row errors is stored (so the preview can show them) but **cannot be published**. Fix the file and stage it again —
a batch is a snapshot of a file, not an editor.

### Publish, precisely

- Only a `STAGED` batch with no row errors publishes; anything else is a `409`.
- **Idempotent.** The first act in the transaction is the claim `STAGED → PUBLISHED`, guarded in the update filter. A second publish
  of the same batch — later or concurrent — is a `409` and applies nothing. The claim is inside the transaction, so a publish that
  fails rolls the claim back: the batch stays `STAGED` and can be retried.
- **Re-validated against the catalog as it is now.** A category deleted, or a SKU taken by another product, since staging refuses
  the whole batch (`409`, nothing applied).
- Applied through the same services the console uses (`createProduct`, `updateProduct`, `setProductLifecycle`, `createVariant`,
  `updateVariant`, `adjustStock`), so every rule they enforce holds: default-locale completeness for a live product (D-11),
  option-key immutability, SKU and `variantKey` uniqueness, the store's default backorder policy, the listing rollup.
- All or nothing: a failure on any row leaves no product, variant or movement.
- `revalidateTags: ["PRODUCTS"]` is declared by the route and fires only after a successful commit. A refused, rolled-back or staged
  batch invalidates nothing.

## The file

UTF-8, comma-delimited, RFC 4180 quoting (a value with a comma, quote or line break goes in double quotes; `""` is a quote).
In Excel: **Save as → CSV UTF-8 (Comma delimited)**. A byte-order mark is fine. A file that is not valid UTF-8 (for example a
Windows-1256 Arabic export) is refused, because reading it leniently would corrupt every Arabic letter. A semicolon-delimited file is
refused with a hint. At most **500 rows** and 2 MB per file.

**One row per variant.** Rows sharing a `product_slug` are one product. Header names are case-insensitive; spaces and hyphens read as
underscores; unknown columns are ignored with a warning. The Bulk import screen downloads a template carrying exactly this header.

### Columns

Required in every file: `product_slug`, `sku`, `price`. Everything else is optional.

**A blank cell never erases existing data.** On an existing product or variant, a blank cell leaves the stored value alone. To clear
something, use the console.

Product-level columns (identical on every row of a product, or blank on the later rows; two different values is an error):

| Column | Meaning |
|---|---|
| `product_slug` | The product's identity and storefront address. Matches an existing product (update) or creates one. 1–200 chars, no spaces or `/ ? # %`. |
| `name_en`, `name_ar` | Product name. A new product needs at least one. |
| `description_en`, `description_ar` | Description. |
| `category_slug` | Must exist. Required for a new product. |
| `brand_slug` | Must exist if given. |
| `status` | `draft` (default for new), `published`, `archived`. |
| `option_axes` | The product's options, `;`-separated, each `key\|English name\|Arabic name` (names optional), e.g. `colour\|Colour\|اللون;size`. Keys: letters, digits, `-`, `_`, up to 50. Left out: the options are inferred from `option_values`, or an existing product keeps its own. |
| `option_value_labels` | Labels for option values, `;`-separated, each `option.value=English\|Arabic`, e.g. `colour.white=White\|أبيض`. A value with no label reads as itself in both languages. |
| `attributes` | Facts customers filter by, `;`-separated, each `attributeKey=valueKey\|English\|Arabic`; repeat the key for several values: `material=cotton\|Cotton\|قطن;material=linen\|Linen\|كتان`. Replaces attributes with the same key; others are kept. |
| `attribute_names` | `attributeKey=English\|Arabic`, `;`-separated. |

Variant-level columns:

| Column | Meaning |
|---|---|
| `sku` | Required, unique across the store, up to 100 chars. Matches an existing variant (update) or creates one. A SKU that belongs to a **different** product is an error. |
| `option_values` | One value per option, `;`-separated `key=value`, e.g. `colour=white;size=m`. Values may not contain `\| = ;`. A new variant needs exactly one per option. An existing variant's options cannot be changed by import. May be omitted when re-pricing an existing variant. |
| `price` | Required. Digits with up to two decimals: `100`, `99.50`. No currency symbol, no thousands separator, no sign. Stays a string end to end — never a float. |
| `compare_at_price`, `cost` | Same format. A compare-at not above the price is a warning (no sale would show). |
| `stock` | Whole number ≥ 0: **the on-hand count the file asserts.** New variant: opening stock, written as a `RECEIPT` movement (note "Opening stock"). Existing variant: the difference from the current count is written as an `ADJUSTMENT` movement (note "Catalog import: <file>"). Blank: stock untouched (a new variant starts at 0). |
| `weight_g`, `length_mm`, `width_mm`, `height_mm` | Non-negative numbers. |
| `unit_of_measure` | `EACH`, `PACK` or `BOX`. |
| `units_per_sale` | Whole number ≥ 1. |
| `active` | `yes`/`no` (or `true`/`false`, `1`/`0`). `no` takes the variant off sale (discontinued). |

### What the file leaves alone

Products and variants the file does not mention are untouched. Option values an option already offers are never removed. Collections,
SEO text, size guides and images are not part of the file: use the console.

## Validation

Found while staging (and again at publish): per-line format errors (missing required cell, malformed amount, bad enum, repeated
SKU, option values that do not fit the product's options, repeated combination), and catalog errors (category or brand that does not
exist, SKU owned by another product, option keys changed on a product that already has variants, an existing variant's options
changed).

**D-11, default language.** A product with `status` `published` must carry its name — and anything else it shows — in the store's
default language (`StoreProfile.defaultLocale`); that is an error, listed against the line. A draft missing it gets a warning (it
will block publishing later). A new product missing the other language gets a warning only. Arabic-first stores therefore may
publish before translating.

A file that cannot be read as a catalog at all — empty, no header, a required column missing, an unclosed quote, over the row cap,
not UTF-8 — is a `400` and no batch is stored.

## Not covered (known)

- Opening-stock movements carry the fixed note "Opening stock" (set by `createVariant`); the batch is traceable through
  `publishedBy`/`publishResult` on the batch, and adjustments carry the file name.
- An import never deletes. Removing or discontinuing a product is a console action (or `active=no` per variant).
- Rows are capped at 500 per file to stay well inside a transaction's lifetime on the replica set.
