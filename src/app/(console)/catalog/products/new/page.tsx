import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { NewProductView } from "src/features/catalog/products/new-product-view";

export const metadata: Metadata = { title: "New product" };

/** `?from=<productId>` pre-fills the form from that product ("Clone" on the products table). */
export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const { from } = await searchParams;
  const cloneFromId = typeof from === "string" && from ? from : undefined;
  return (
    <PermissionGuard permission={AppPermission.PRODUCT.CREATE} fallback={<NoAccess />}>
      <NewProductView cloneFromId={cloneFromId} />
    </PermissionGuard>
  );
}
