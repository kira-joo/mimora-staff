"use client";

import { isApiError, requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, EmptyState, showApiErrorToast, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, PackageSearch, RotateCcw } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { saveProductOrderEndpoint, type ArrangeProduct, type ProductOrderScope } from "src/api/products.endpoints";
import { moveItem } from "src/components/reorder-dialog";
import { ProductLifecycleSignal } from "src/features/status/status-signal";
import { displayName } from "../catalog-display";
import { GroupThumb } from "../product-groups/group-thumb";

const TARGET = "inline-flex size-11 flex-none items-center justify-center";

/**
 * The editable list for one scope. It is keyed by the caller on the load it was built from, so a reload or a save starts
 * it afresh from the server's order — and a background refetch never resets an arrangement in progress (the caller
 * switches those off). Drag by the handle (the rest of the row still scrolls on touch) or use Move up / Move down.
 */
export function ArrangeProductsList({ products, scope, scopeNote, onDirtyChange, onReload }: {
  products: ArrangeProduct[];
  scope: ProductOrderScope;
  scopeNote?: string;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => void;
}) {
  const queryClient = useQueryClient();
  const savedIds = useMemo(() => products.map((product) => product._id), [products]);
  const byId = useMemo(() => new Map(products.map((product) => [product._id, product])), [products]);
  const [order, setOrder] = useState(savedIds);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string>();
  const dirty = order.some((id, index) => id !== savedIds[index]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  async function save() {
    setSaving(true);
    setConflict(undefined);
    try {
      const result = await requester(saveProductOrderEndpoint, { body: { ...scope, productIds: order } });
      toast.success(result.updated === 0 ? "Order saved" : `Order saved — ${result.updated} ${result.updated === 1 ? "product" : "products"} moved`);
      // The list refetches and this component is rebuilt from the saved order; product tables and storefront listings follow.
      void queryClient.invalidateQueries();
    } catch (error) {
      if (isApiError(error) && error.statusCode === 409) setConflict(error.message);
      else showApiErrorToast(isApiError(error) ? error : { message: "Something went wrong. Try again." });
    } finally {
      setSaving(false);
    }
  }

  if (products.length === 0) {
    return <EmptyState icon={PackageSearch} title="No products here" description="Nothing to arrange. Archived products are not shown." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[var(--st-ink-muted)]">
        Drag a row by its handle, or use the arrows. The storefront lists products in this order unless a shopper chooses another sort.
        {scopeNote ? ` ${scopeNote}` : ""}
      </p>

      {conflict ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--st-status-danger)] p-3 text-[13px]">
          <span className="font-medium text-[var(--st-status-danger)]">{conflict}</span>
          <CustomButton variant="outline" leftIcon={RotateCcw} onClick={onReload}>
            Reload list
          </CustomButton>
        </div>
      ) : null}

      <Reorder.Group as="ol" axis="y" values={order} onReorder={setOrder} className="flex flex-col divide-y divide-[var(--st-line)] rounded-md border border-[var(--st-line)]" aria-label="Products in their storefront order">
        {order.map((id, index) => {
          const product = byId.get(id);
          return product ? (
            <ArrangeRow
              key={id}
              product={product}
              index={index}
              count={order.length}
              busy={saving}
              onMove={(direction) => setOrder((current) => moveItem(current, index, direction))}
            />
          ) : null;
        })}
      </Reorder.Group>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-[var(--st-line)] bg-[var(--st-surface)] py-3">
        <CustomButton onClick={() => void save()} loading={saving} disabled={!dirty || saving}>
          Save order
        </CustomButton>
        <CustomButton variant="outline" leftIcon={RotateCcw} onClick={() => { setOrder(savedIds); setConflict(undefined); }} disabled={!dirty || saving}>
          Reset
        </CustomButton>
        <span role="status" className="text-[13px] text-[var(--st-ink-muted)]">
          {dirty ? "Unsaved changes" : `${order.length} ${order.length === 1 ? "product" : "products"}`}
        </span>
      </div>
    </div>
  );
}

function ArrangeRow({ product, index, count, busy, onMove }: { product: ArrangeProduct; index: number; count: number; busy: boolean; onMove: (direction: -1 | 1) => void }) {
  const controls = useDragControls();
  const name = displayName(product.name) || product.slug;

  return (
    <Reorder.Item as="li" value={product._id} dragListener={false} dragControls={controls} className="flex min-h-14 items-center gap-1 bg-[var(--st-surface)] ps-1 pe-1 sm:gap-2">
      <button
        type="button"
        aria-label={`Drag ${name} to reorder`}
        disabled={busy}
        // `touch-action: none` on the handle only, so the rest of the row still scrolls the page on touch.
        style={{ touchAction: "none" }}
        onPointerDown={(event) => controls.start(event)}
        className={`${TARGET} cursor-grab rounded-md text-[var(--st-ink-muted)] hover:bg-[var(--st-accent-soft)] active:cursor-grabbing disabled:opacity-60`}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <span className="st-figure w-7 flex-none text-end text-[13px] text-[var(--st-ink-muted)]">{index + 1}</span>
      <GroupThumb image={product.listing.primaryImage} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-1">
        <span dir="auto" className="truncate font-medium text-[var(--st-ink)]">
          {name}
        </span>
        <ProductLifecycleSignal lifecycle={product.lifecycle} />
      </div>
      <CustomButton variant="ghost" size="icon" className="size-11" aria-label={`Move ${name} up`} disabled={index === 0 || busy} onClick={() => onMove(-1)}>
        <ArrowUp className="size-4" aria-hidden="true" />
      </CustomButton>
      <CustomButton variant="ghost" size="icon" className="size-11" aria-label={`Move ${name} down`} disabled={index === count - 1 || busy} onClick={() => onMove(1)}>
        <ArrowDown className="size-4" aria-hidden="true" />
      </CustomButton>
    </Reorder.Item>
  );
}
