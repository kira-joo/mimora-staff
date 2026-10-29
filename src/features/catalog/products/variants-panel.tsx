"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { drawerPresentation, useConfirm, useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { Archive, ArchiveRestore, Images, Pencil, Plus, Trash2 } from "lucide-react";
import type { Product } from "src/api/products.endpoints";
import { createVariantEndpoint, deleteVariantEndpoint, listVariantsEndpoint, updateVariantEndpoint, type Variant } from "src/api/variants.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { usePermission } from "src/features/auth/use-permission";
import { VariantGalleryDialog } from "src/features/media/variant-gallery-dialog";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { optionSummary } from "./variant-values";
import { VariantDrawer } from "./variant-drawer";

/**
 * A product's variants — each owns its price and its stock. Discontinue is the
 * reversible off-switch; delete removes a variant made by mistake (past orders
 * keep their snapshot). Every write refreshes the product too: its listing
 * rollup (price range, sellable count) changes with them.
 */
export function VariantsPanel({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const can = usePermission();
  const format = useStoreFormat();
  const { openDialog } = useDialog();
  const { confirm } = useConfirm();
  const query = useRequesterQuery({ endpoint: listVariantsEndpoint, options: { query: { productId: product._id, limit: 100 } } });
  const variants = query.data?.data ?? [];

  const refresh = () => {
    void query.refetch();
    onChanged();
  };

  async function openDrawer(props: Pick<Parameters<typeof VariantDrawer>[0], "endpoint" | "oldData">) {
    const outcome = await openDialog<typeof VariantDrawer, boolean>({
      component: VariantDrawer,
      props: { product, ...props },
      presentation: drawerPresentation({ side: "inline-end" }),
    }).result;
    if (outcome.status === "resolved") refresh();
  }
  async function pickImages(variant: Variant) {
    const outcome = await openDialog<typeof VariantGalleryDialog, boolean>({
      component: VariantGalleryDialog,
      props: { product, variant },
      presentation: drawerPresentation({ side: "inline-end" }),
    }).result;
    if (outcome.status === "resolved" && outcome.value) refresh();
  }
  const add = () => openDrawer({ endpoint: createVariantEndpoint });
  const edit = (variant: Variant) => openDrawer({ endpoint: updateVariantEndpoint, oldData: variant });

  async function setDiscontinued(variant: Variant, discontinued: boolean) {
    if (discontinued) {
      const ok = await confirm({
        title: `Discontinue ${variant.sku}?`,
        description: "Customers can no longer buy it. Its stock and history stay, and you can restore it here.",
        confirmLabel: "Discontinue",
        destructive: true,
      });
      if (!ok) return;
    }
    if (await runAction(() => requester(updateVariantEndpoint, { params: { id: variant._id }, body: { discontinued } }), `${variant.sku} ${discontinued ? "discontinued" : "restored"}`)) refresh();
  }

  async function remove(variant: Variant) {
    const ok = await confirm({
      title: `Delete ${variant.sku}?`,
      description: "For a variant made by mistake. It is removed for good, with its stock count; past orders keep their own record. To stop selling it instead, discontinue it.",
      confirmLabel: "Delete variant",
      destructive: true,
    });
    if (ok && (await runAction(() => requester(deleteVariantEndpoint, { params: { id: variant._id } }), `${variant.sku} deleted`))) refresh();
  }

  return (
    <section aria-labelledby="variants-heading" className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--st-line)] px-4 py-3">
        <h2 id="variants-heading" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
          Variants ({query.data?.total ?? "…"})
        </h2>
        {can(AppPermission.VARIANT.CREATE) ? (
          <CustomButton leftIcon={Plus} onClick={add}>
            Add variant
          </CustomButton>
        ) : null}
      </header>
      {query.isLoading ? (
        <p className="px-4 py-6 text-[var(--st-ink-muted)]">Loading variants…</p>
      ) : variants.length === 0 ? (
        <p className="px-4 py-6 text-[var(--st-ink-muted)]">No variants yet. A product can&apos;t be bought until one is added.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-start">
            <thead>
              <tr className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">
                <th scope="col" className="px-4 py-2 text-start font-semibold">SKU</th>
                <th scope="col" className="px-4 py-2 text-start font-semibold">Options</th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">Price</th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">Stock</th>
                <th scope="col" className="px-4 py-2 text-start font-semibold">Status</th>
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant._id} className="border-t border-[var(--st-line)]">
                  <td className="st-figure whitespace-nowrap px-4 py-2">{variant.sku}</td>
                  <td dir="auto" className="max-w-56 truncate px-4 py-2">
                    {optionSummary(product.optionAxes, variant) || "—"}
                  </td>
                  <td className="st-figure whitespace-nowrap px-4 py-2 text-end">
                    {format.money(variant.price)}
                    {variant.compareAtPrice ? <span className="ms-2 text-[var(--st-ink-muted)] line-through">{format.money(variant.compareAtPrice)}</span> : null}
                  </td>
                  <td className="st-figure px-4 py-2 text-end">{variant.stock}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: TONE_VAR[variant.discontinued ? "neutral" : "done"] }}>
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                      {variant.discontinued ? "Discontinued" : "Active"}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end">
                      {can(AppPermission.VARIANT.UPDATE) ? (
                        <>
                          <CustomButton variant="ghost" size="icon" aria-label={`Edit ${variant.sku}`} onClick={() => edit(variant)}>
                            <Pencil className="size-4" aria-hidden="true" />
                          </CustomButton>
                          <CustomButton variant="ghost" size="icon" aria-label={`Images for ${variant.sku}${variant.galleryOverride?.length ? ` (${variant.galleryOverride.length} chosen)` : ""}`} onClick={() => pickImages(variant)}>
                            <Images className="size-4" aria-hidden="true" />
                          </CustomButton>
                          <CustomButton
                            variant="ghost"
                            size="icon"
                            aria-label={variant.discontinued ? `Restore ${variant.sku}` : `Discontinue ${variant.sku}`}
                            onClick={() => setDiscontinued(variant, !variant.discontinued)}
                          >
                            {variant.discontinued ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
                          </CustomButton>
                        </>
                      ) : null}
                      {can(AppPermission.VARIANT.DELETE) ? (
                        <CustomButton variant="ghost" size="icon" aria-label={`Delete ${variant.sku}`} onClick={() => remove(variant)}>
                          <Trash2 className="size-4 text-[var(--st-status-danger)]" aria-hidden="true" />
                        </CustomButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
