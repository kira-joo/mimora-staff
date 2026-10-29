"use client";

import { RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FeatureTable } from "@kira-joo/frontend-toolkit-tailwind/table";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { listCategoriesEndpoint } from "src/api/categories.endpoints";
import { listProductsEndpoint, type ProductListItem } from "src/api/products.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { ProductLifecycleSignal } from "src/features/status/status-signal";
import { LocalizedNameCell } from "../catalog-display";
import { useCatalogOptions } from "../use-catalog-options";
import { priceRange } from "./product-display";

/**
 * Every product, in merchandising order, searchable by name and description.
 * Price and sellable-variant count come from the product's listing rollup —
 * maintained by the backend with every variant write, never computed here.
 */
export function ProductsTable() {
  const router = useRouter();
  const format = useStoreFormat();
  const categories = useCatalogOptions(listCategoriesEndpoint);
  const categoryName = useMemo(() => new Map(categories.options.map((option) => [option.value, option.label])), [categories.options]);

  return (
    <FeatureTable<ProductListItem>
      endpoint={listProductsEndpoint}
      entityName="products"
      defaultLimit={25}
      filters={[
        {
          key: "lifecycle",
          header: "Lifecycle",
          options: [
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
            { value: "archived", label: "Archived" },
          ],
        },
        { key: "categoryId", header: "Category", options: categories.options },
      ]}
      headerActions={
        <RouteButton path={AppRoute.PRODUCT_NEW} permission={AppPermission.PRODUCT.CREATE} leftIcon={Plus}>
          New product
        </RouteButton>
      }
      onRowClick={(row) => router.push(AppRoute.PRODUCT(row._id))}
      emptyMessage="No products yet"
      emptyDescription="Create a product, then add its variants — each variant carries its own price and stock."
      columns={[
        { key: "name", header: "Product", render: (row) => <LocalizedNameCell name={row.name} /> },
        {
          key: "categoryId",
          header: "Category",
          render: (row) => (
            <span dir="auto" className="truncate">
              {categoryName.get(row.categoryId) ?? "—"}
            </span>
          ),
        },
        { key: "listing", header: "Price", render: (row) => <span className="st-figure whitespace-nowrap">{priceRange(row.listing, format.money)}</span> },
        {
          key: "purchasable",
          header: "Sellable variants",
          render: (row) => (
            <span className={row.listing.purchasableVariantCount === 0 ? "st-figure text-[var(--st-status-danger)]" : "st-figure"}>{row.listing.purchasableVariantCount}</span>
          ),
        },
        { key: "lifecycle", header: "Lifecycle", render: (row) => <ProductLifecycleSignal lifecycle={row.lifecycle} /> },
      ]}
    />
  );
}
