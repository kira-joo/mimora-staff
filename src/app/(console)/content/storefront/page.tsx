import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { StorefrontContentView } from "src/features/content/storefront-content/storefront-content-view";

export const metadata: Metadata = { title: "Storefront content" };

export default function StorefrontContentPage() {
  return (
    <PermissionGuard permission={AppPermission.STOREFRONT_CONTENT.READ} fallback={<NoAccess />}>
      <StorefrontContentView />
    </PermissionGuard>
  );
}
