"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getProductEndpoint, updateProductEndpoint } from "src/api/products.endpoints";
import { listVariantsEndpoint } from "src/api/variants.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
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
          maxWidth="4xl"
        >
          <div className="flex flex-col gap-6">
            <VariantsPanel product={product} onChanged={() => void query.refetch()} />
            <VariantMatrixPanel product={product} onChanged={() => void query.refetch()} />
            <ProductImageManager key={`${product.updatedAt}-${product.images?.length ?? 0}`} product={product} onChanged={() => void query.refetch()} />
            <ProductForm key={product.updatedAt} endpoint={updateProductEndpoint} oldData={product} variantCount={variants.data?.total ?? 0} />
          </div>
        </PageShell>
      )}
    </QueryState>
  );
}
