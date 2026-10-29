import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PageEditView } from "src/features/content/page-edit-view";

export const metadata: Metadata = { title: "Page" };

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.PAGE.READ_ONE} fallback={<NoAccess />}>
      <PageEditView id={id} />
    </PermissionGuard>
  );
}
