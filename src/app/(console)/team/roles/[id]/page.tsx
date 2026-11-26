import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { RoleEditView } from "src/features/team/role-edit-view";

export const metadata: Metadata = { title: "Edit role" };

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.ROLE.UPDATE} fallback={<NoAccess />}>
      <RoleEditView id={id} />
    </PermissionGuard>
  );
}
