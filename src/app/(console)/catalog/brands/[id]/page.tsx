import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { BrandEditView } from "src/features/brands/brand-edit-view";

export const metadata: Metadata = { title: "Brand" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.BRAND.READ_ONE} fallback={<NoAccess />}>
      <BrandEditView id={id} />
    </PermissionGuard>
  );
}
