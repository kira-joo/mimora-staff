import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { SizeGuideEditView } from "src/features/catalog/size-guides/size-guide-edit-view";

export const metadata: Metadata = { title: "Size guide" };

export default async function SizeguidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.SIZE_GUIDE.READ_ONE} fallback={<NoAccess />}>
      <SizeGuideEditView id={id} />
    </PermissionGuard>
  );
}
