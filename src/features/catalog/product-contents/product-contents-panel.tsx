"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { FeatureFilterCombobox } from "@kira-joo/frontend-toolkit-tailwind/combobox";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { ArrowDown, ArrowUp, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MAX_CONTENT_ITEMS, getProductContentsEndpoint, setProductContentsEndpoint, type ProductContents } from "src/api/product-contents.endpoints";
import { listProductsEndpoint, type Product, type ProductListItem } from "src/api/products.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { ProductLifecycleSignal } from "src/features/status/status-signal";
import { displayName } from "../catalog-display";
import { GroupThumb } from "../product-groups/group-thumb";
import { moveRow } from "../product-groups/group-members";
import { contentRowProblems, contentsBody, rowsOfContents, sameContents, type ContentRow } from "./contents-list";

/**
 * What’s inside this product (a gift box): other existing products, each with a quantity. They are referenced, not
 * copied, so their current name and images always show on this product’s page. The box keeps its own price and stock.
 */
export function ProductContentsPanel({ product }: { product: Product }) {
  const query = useRequesterQuery({ endpoint: getProductContentsEndpoint, options: { params: { id: product._id } } });
  return (
    <section aria-labelledby="product-contents-heading" className="flex flex-col gap-3 rounded-lg border border-[var(--st-line)] bg-[var(--st-surface)] p-4 sm:p-5">
      <header className="flex flex-col gap-1">
        <h2 id="product-contents-heading" className="text-base font-semibold text-[var(--st-ink)]">
          What’s inside
        </h2>
        <p className="text-[13px] text-[var(--st-ink-muted)]">
          For a box or set: the products it contains. Customers see them on this product’s page with their current names and images, and can open each one. Only published products are shown to customers.
        </p>
      </header>
      {query.data ? <ContentsEditor key={JSON.stringify(contentsBody(rowsOfContents(query.data.items)))} product={product} saved={query.data} onSaved={() => void query.refetch()} /> : <p className="text-[var(--st-ink-muted)]">Loading…</p>}
    </section>
  );
}

function ContentsEditor({ product, saved, onSaved }: { product: Product; saved: ProductContents; onSaved: () => void }) {
  const can = usePermission();
  const canEdit = can(AppPermission.PRODUCT.UPDATE);
  const [rows, setRows] = useState<ContentRow[]>(() => rowsOfContents(saved.items));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems = contentRowProblems(product._id, rows);
  const dirty = !sameContents(rows, saved.items);

  function add(item: ProductListItem | undefined) {
    if (!item || item._id === product._id) return;
    setRows((current) => (current.some((row) => row.productId === item._id) ? current : [...current, { productId: item._id, name: item.name, slug: item.slug, lifecycle: item.lifecycle, image: undefined, quantity: "1" }]));
  }

  async function save() {
    setAttempted(true);
    if (problems.length > 0) return;
    setBusy(true);
    if (await runAction(() => requester(setProductContentsEndpoint, { params: { id: product._id }, body: contentsBody(rows) }), "Contents saved")) onSaved();
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? <p className="text-[var(--st-ink-muted)]">No included products.</p> : null}
      <ol className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={row.productId} className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--st-line)] p-3">
            <GroupThumb image={row.image} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Link href={AppRoute.PRODUCT(row.productId)} className="inline-flex min-w-0 items-center gap-1 font-medium text-[var(--st-ink)] hover:underline">
                <span dir="auto" className="truncate">
                  {displayName(row.name)}
                </span>
                <ExternalLink aria-hidden="true" className="size-3.5 flex-none" />
              </Link>
              <ProductLifecycleSignal lifecycle={row.lifecycle} />
            </div>
            <div className="w-24">
              <CustomInput label="Quantity" inputMode="numeric" className="st-figure" value={row.quantity} disabled={!canEdit || busy} onChange={(event) => setRows((current) => current.map((r, i) => (i === index ? { ...r, quantity: event.target.value } : r)))} />
            </div>
            {canEdit ? (
              <div className="flex gap-1">
                <CustomButton type="button" variant="ghost" size="icon" aria-label={`Move ${displayName(row.name)} up`} disabled={busy || index === 0} onClick={() => setRows((current) => moveRow(current, index, -1))}>
                  <ArrowUp className="size-4" aria-hidden="true" />
                </CustomButton>
                <CustomButton type="button" variant="ghost" size="icon" aria-label={`Move ${displayName(row.name)} down`} disabled={busy || index === rows.length - 1} onClick={() => setRows((current) => moveRow(current, index, 1))}>
                  <ArrowDown className="size-4" aria-hidden="true" />
                </CustomButton>
                <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove ${displayName(row.name)}`} disabled={busy} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </CustomButton>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {canEdit ? (
        <>
          <div className="max-w-xl">
            <span className="mb-1 block text-[13px] font-medium text-[var(--st-ink)]">Add an included product</span>
            <FeatureFilterCombobox<ProductListItem, typeof listProductsEndpoint>
              key={rows.length}
              endpoint={listProductsEndpoint}
              searchQueryKey="search"
              query={{ limit: 20 }}
              optionLabel={(item) => displayName(item.name)}
              optionValue="_id"
              placeholder="Search products by name"
              emptyMessage="No matching products"
              onChange={(_value, item) => add(item)}
            />
            <p className="mt-1 text-[13px] text-[var(--st-ink-muted)]">Up to {MAX_CONTENT_ITEMS} products. This product’s own price and stock are not affected.</p>
          </div>
          {attempted && problems.length > 0 ? (
            <ul role="alert" className="list-disc ps-5 text-[13px] font-medium text-[var(--st-status-danger)]">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <CustomButton onClick={() => void save()} loading={busy} disabled={busy || !dirty}>
              Save contents
            </CustomButton>
            {dirty ? <span className="text-[13px] text-[var(--st-ink-muted)]">Unsaved changes</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
