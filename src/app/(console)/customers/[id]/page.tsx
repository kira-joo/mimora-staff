import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CustomerDetailView } from "src/features/customers/customer-detail";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.CUSTOMER.READ_ONE} fallback={<NoAccess />}>
      <CustomerDetailView id={id} />
    </PermissionGuard>
  );
}
