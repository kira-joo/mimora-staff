import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CollectionEditView } from "src/features/catalog/collections/collection-edit-view";

export const metadata: Metadata = { title: "Collection" };

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.COLLECTION.READ_ONE} fallback={<NoAccess />}>
      <CollectionEditView id={id} />
    </PermissionGuard>
  );
}
