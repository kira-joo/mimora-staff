"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getBrandEndpoint, updateBrandEndpoint } from "src/api/brands.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { BrandForm } from "./brand-form";

/** The detail/edit pattern: QueryState owns loading, not-found and error; the page renders only real data. */
export function BrandEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getBrandEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="brand" backRoute={{ path: AppRoute.BRANDS, label: "Brands" }}>
      {(brand) => (
        <PageShell title={<span dir="auto">{brand.name.en || brand.name.ar}</span>} backRoute={{ path: AppRoute.BRANDS, label: "Brands" }}>
          <BrandForm key={brand.updatedAt} endpoint={updateBrandEndpoint} oldData={brand} />
        </PageShell>
      )}
    </QueryState>
  );
}
