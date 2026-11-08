"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { createProductEndpoint, getProductEndpoint } from "src/api/products.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "../catalog-display";
import { ProductForm } from "./product-form";

const BACK = { path: AppRoute.PRODUCTS, label: "Products" };

/** The New product page — blank, or (`cloneFromId`) pre-filled from an existing product. Either way one form, one create. */
export function NewProductView({ cloneFromId }: { cloneFromId?: string }) {
  if (!cloneFromId) {
    return (
      <PageShell title="New product" description="Starts as a draft. Add its variants on the next page, then publish." backRoute={BACK}>
        <ProductForm endpoint={createProductEndpoint} />
      </PageShell>
    );
  }
  return <CloneProduct id={cloneFromId} />;
}

function CloneProduct({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getProductEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="product to copy" backRoute={BACK}>
      {(source) => (
        <PageShell
          title="New product"
          description={
            <span>
              Copied from <span dir="auto">{displayName(source.name)}</span>. Review and change anything, then create it as a new draft. Variants, SKUs, prices,
              stock and images are not copied.
            </span>
          }
          backRoute={BACK}
        >
          {/* Keyed on the source, so moving between two copies starts a fresh form. */}
          <ProductForm key={source._id} endpoint={createProductEndpoint} cloneOf={source} />
        </PageShell>
      )}
    </QueryState>
  );
}
