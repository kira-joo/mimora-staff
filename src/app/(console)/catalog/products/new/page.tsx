import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createProductEndpoint } from "src/api/products.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { ProductForm } from "src/features/catalog/products/product-form";

export const metadata: Metadata = { title: "New product" };

export default function NewProductPage() {
  return (
    <PermissionGuard permission={AppPermission.PRODUCT.CREATE} fallback={<NoAccess />}>
      <PageShell
        title="New product"
        description="Starts as a draft. Add its variants on the next page, then publish."
        backRoute={{ path: AppRoute.PRODUCTS, label: "Products" }}
        maxWidth="4xl"
      >
        <ProductForm endpoint={createProductEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
