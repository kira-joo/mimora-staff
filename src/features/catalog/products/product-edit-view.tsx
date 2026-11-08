"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { useState } from "react";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getProductEndpoint, updateProductEndpoint, type Product } from "src/api/products.endpoints";
import { listVariantsEndpoint } from "src/api/variants.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { sameGallery } from "src/features/media/image-gallery";
import { ProductImageManager } from "src/features/media/product-image-manager";
import { ProductLifecycleSignal } from "src/features/status/status-signal";
import { displayName } from "../catalog-display";
import { priceRange } from "./product-display";
import { ProductForm } from "./product-form";
import { ProductLifecycleActions } from "./product-lifecycle-actions";
import { VariantMatrixPanel } from "./variant-matrix-panel";
import { VariantsPanel } from "./variants-panel";

export function ProductEditView({ id }: { id: string }) {
  const format = useStoreFormat();
  const query = useRequesterQuery({ endpoint: getProductEndpoint, options: { params: { id } } });
  // The same query the variants panel runs (shared by key), for the variant count the options editor warns with.
  const variants = useRequesterQuery({ endpoint: listVariantsEndpoint, options: { query: { productId: id, limit: 100 } } });
  const back = { path: AppRoute.PRODUCTS, label: "Products" };

  return (
    <QueryState query={query} entityName="product" backRoute={back}>
      {(product) => (
        <PageShell
          title={<span dir="auto">{displayName(product.name)}</span>}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ProductLifecycleSignal lifecycle={product.lifecycle} />
              {product.listing.minActivePrice || product.listing.maxActivePrice ? <span className="st-figure">{priceRange(product.listing, format.money)}</span> : null}
              <span>
                {product.listing.purchasableVariantCount} sellable {product.listing.purchasableVariantCount === 1 ? "variant" : "variants"}
              </span>
            </span>
          }
          backRoute={back}
          actions={<ProductLifecycleActions product={product} onChanged={() => void query.refetch()} />}
        >
          <div className="flex flex-col gap-6">
            <VariantsPanel product={product} onChanged={() => void query.refetch()} />
            <VariantMatrixPanel product={product} onChanged={() => void query.refetch()} />
            <ProductContent product={product} variantCount={variants.data?.total ?? 0} onChanged={() => void query.refetch()} />
          </div>
        </PageShell>
      )}
    </QueryState>
  );
}

/**
 * The gallery and the product form share one pending gallery, held here: an image added in the gallery is saved by
 * either "Save images" or "Save product", and a reload after an unrelated change (a variant, the form) keeps it.
 * The pending gallery is replaced only when the STORED gallery changes — after a save — so nothing unsaved is dropped.
 */
function ProductContent({ product, variantCount, onChanged }: { product: Product; variantCount: number; onChanged: () => void }) {
  const stored = product.images ?? [];
  const [images, setImages] = useState<ImageAsset[]>(stored);
  const [storedSeen, setStoredSeen] = useState<ImageAsset[]>(stored);
  if (!sameGallery(storedSeen, stored)) {
    setStoredSeen(stored);
    setImages(stored);
  }

  return (
    <>
      <ProductImageManager product={product} images={images} onImagesChange={setImages} onChanged={onChanged} />
      <ProductForm key={product.updatedAt} endpoint={updateProductEndpoint} oldData={product} variantCount={variantCount} pendingImages={images} />
    </>
  );
}
