# Catalog importer

Adds a batch of new products — images, products, variants and product groups — from one folder, through the staff
admin API (signed in as a staff member, exactly like the console). It never writes to MongoDB directly, never edits or
deletes an existing product, and can be re-run safely.

## The folder — everything lives with the importer

```
mimora-staff/
  scripts/catalog-import/
    cli.mjs, run.mjs, …          the importer
    README.md                    this file
    product-import/              ← THE BATCH: put it here
      catalog.json               the products, variants and groups
      photo-1.jpeg               every file catalog.json names in "sourceImageFilename"
      photo-2.png
      .catalog-import-state.json written by --execute: what it created (keep it until the batch is done)
      import-reports/            one JSON report per run
      .gitignore, README.md      the only tracked files — a batch is never committed
```

All paths are resolved from the importer's own folder, never from where you run the command. `--dir <folder>` imports
from another folder: an absolute path as given, a relative one taken from `scripts/catalog-import/`.

`catalog.json`:

```json
{
  "products": [
    {
      "sourceImageFilename": "photo-1.jpeg",
      "product": {
        "name": { "en": "…", "ar": "…" }, "description": { "en": "…", "ar": "…" },
        "slug": "gold-crystal-adjustable-bracelet",
        "categoryId": "<24-char id>", "collectionIds": ["<24-char id>"],
        "optionAxes": [], "attributes": [],
        "seoTitle": { "en": "…", "ar": "…" }, "seoDescription": { "en": "…", "ar": "…" },
        "lifecycle": "published"
      },
      "variants": [{ "sku": "GOLD-CRYSTAL-BRACELET", "optionValues": [], "price": "100.00", "stock": 10 }]
    }
  ],
  "productGroupAssignmentSteps": [
    {
      "groupName": { "en": "Cherry Scrunchies", "ar": "توك شعر الكرز" },
      "membersInStorefrontOrder": [
        { "productSlug": "white-cherry-scrunchie", "label": { "en": "White", "ar": "أبيض" } }
      ]
    }
  ]
}
```

- `product` and each variant are the admin API's create bodies (`CreateProductDto`, `CreateVariantDto`) without
  `images` / `productId`, which the importer supplies. Unknown keys are refused, not ignored.
- A gallery: `"sourceImageFilenames": ["front.jpeg", "back.jpeg"]` instead of `sourceImageFilename` (first = main).
- Prices are strings (`"100.00"`), never numbers. `lifecycle` is required — it is never assumed.
- A product without options has exactly one variant; with options, one variant per distinct combination.
- Group members must be products in the same file; a product is in at most one group; labels need both languages.
- Images: JPEG, PNG or WebP, ≤ 8 MB, 200–8000 px (the console's own upload rules).

## Run it

From `mimora-staff/` or any folder inside it (npm always runs the script from the package):

```bash
# 1. Always first: see everything that would happen. Uploads and creates nothing.
npm run catalog:import -- --dry-run --target https://mimora-staff.vercel.app

# 2. Then, when the dry run says "Outcome: ready":
npm run catalog:import -- --execute --target https://mimora-staff.vercel.app --confirm-target mimora-staff.vercel.app
```

From anywhere else — the result is identical, the batch folder is still `scripts/catalog-import/product-import/`:

```bash
npm --prefix /path/to/mimora-staff run catalog:import -- --dry-run --target https://mimora-staff.vercel.app
node /path/to/mimora-staff/scripts/catalog-import/cli.mjs --dry-run --target https://mimora-staff.vercel.app
```

- Sign-in: set `MIMORA_STAFF_EMAIL` / `MIMORA_STAFF_PASSWORD`, or you are asked (the password is not shown). The account
  needs Product create/update, Variant create, ProductGroup create/update and Category/Collection read (Owner has all).
- `--target` (or `MIMORA_STAFF_URL`) is always explicit. `--execute` against anything but localhost also needs
  `--confirm-target <host>` typed out, so a production run is never an accident.
- The dry run uploads and creates nothing. Signing in itself records a staff session (as logging into the console does);
  that is the only thing either mode writes before `--execute` starts the import.

## What `--execute` does, in order

1. Validates the JSON, the images, the categories and collections, and checks every slug and SKU against the store.
   **If anything is blocking, it stops here and writes nothing.**
2. Per product: uploads its image(s) through the console's upload route → creates the product **as a draft** with them
   (`?onSlugTaken=reject`, so the server refuses — never renames — a taken slug) → creates its variants → sets the
   lifecycle the JSON asks for. A product is never live before it has its price.
3. When every member of a group is complete: creates the group, then saves its members in `membersInStorefrontOrder`
   with their labels.
4. Re-reads everything it created and checks it (slug, category, collections, lifecycle, images, prices, stock, group
   order and labels).

It stops at the first failure. Everything done before it is saved.

## Re-running, resuming, and what is never touched

`scripts/catalog-import/product-import/.catalog-import-state.json` records, per store, every image uploaded, product, variant and group this
importer created. On every run:

| Found in the store | What happens |
|---|---|
| Slug not in the store | created |
| Created by an earlier run, unfinished (e.g. stopped at a variant) | **resumed** — only the missing steps; its image is not uploaded again |
| Created by an earlier run, finished | **done** — left alone, even if edited since |
| Slug exists but this importer did not create it | **skipped** and flagged — never modified; a group that needs it is blocked |
| SKU already on another product | **blocking** |
| Image uploaded by an earlier run (same file content) | **re-used** — after checking it still exists; uploaded again only if it is gone |

**A create whose response never arrived** (crash, dropped connection) is not orphaned: the importer records its intent
— and the image it is sending — BEFORE each create. On the next run a product carrying exactly that freshly uploaded
image is recognised as its own and resumed; a group is adopted only if exactly one empty group has its name (several are
reported for you to clean up).

**One run at a time:** `--execute` holds `product-import/.catalog-import.lock` while it runs; a second run is refused. A
lock left behind by a crashed run names its process id and start time — delete it by hand once that run is gone.

Keep the state file with the folder until the batch is finished. Delete it only if you mean "this importer created
nothing in that store".

## Reports

Every run writes `scripts/catalog-import/product-import/import-reports/<time>-<dry-run|execute>.json`: the full plan, every step with its result
and error, and the verification checks. Credentials and cookies are never written anywhere.

## Next batch

Replace `catalog.json` and the images in `scripts/catalog-import/product-import/`, move the old state file and reports
aside (or keep them — they are per store and only match slugs/files of their own batch), and run the dry run again.
Keep `.gitignore` and `README.md` in that folder.
