"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { useState } from "react";
import { setProductLifecycleEndpoint, type Product, type ProductLifecycle } from "src/api/products.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { usePermission } from "src/features/auth/use-permission";
import { displayName } from "../catalog-display";

/**
 * The next lifecycle steps from where the product is. Publishing a product
 * with nothing to buy is allowed (the API permits it) but said plainly first.
 */
export function ProductLifecycleActions({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const can = usePermission();
  const { confirm } = useConfirm();
  const [pending, setPending] = useState<ProductLifecycle | null>(null);
  if (!can(AppPermission.PRODUCT.UPDATE)) return null;
  const name = displayName(product.name);

  async function move(lifecycle: ProductLifecycle, success: string) {
    setPending(lifecycle);
    const ok = await runAction(() => requester(setProductLifecycleEndpoint, { params: { id: product._id }, body: { lifecycle } }), success);
    setPending(null);
    if (ok) onChanged();
  }

  async function publish() {
    const sellable = product.listing.purchasableVariantCount;
    const ok = await confirm({
      title: `Publish ${name}?`,
      description:
        sellable > 0
          ? `It appears on the storefront with ${sellable} ${sellable === 1 ? "variant" : "variants"} customers can buy.`
          : "It appears on the storefront, but no variant can be bought yet — customers will see it as unavailable.",
      confirmLabel: "Publish",
    });
    if (ok) await move("published", `${name} published`);
  }

  async function archive() {
    const ok = await confirm({
      title: `Archive ${name}?`,
      description: "It leaves the storefront and the active catalog. Its variants, stock and order history stay; you can restore it as a draft.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (ok) await move("archived", `${name} archived`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {product.lifecycle === "published" ? (
        <CustomButton variant="outline" loading={pending === "draft"} disabled={pending !== null} onClick={() => move("draft", `${name} moved to drafts`)}>
          Unpublish to draft
        </CustomButton>
      ) : null}
      {product.lifecycle === "archived" ? (
        <CustomButton variant="outline" loading={pending === "draft"} disabled={pending !== null} onClick={() => move("draft", `${name} restored as a draft`)}>
          Restore as draft
        </CustomButton>
      ) : null}
      {product.lifecycle !== "archived" ? (
        <CustomButton variant="outline" loading={pending === "archived"} disabled={pending !== null} onClick={archive}>
          Archive
        </CustomButton>
      ) : null}
      {product.lifecycle === "draft" ? (
        <CustomButton loading={pending === "published"} disabled={pending !== null} onClick={publish}>
          Publish
        </CustomButton>
      ) : null}
    </div>
  );
}
