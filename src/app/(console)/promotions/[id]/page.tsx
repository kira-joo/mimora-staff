import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PromotionEditView } from "src/features/promotions/promotion-edit-view";

export const metadata: Metadata = { title: "Promotion" };

export default async function PromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.PROMOTION.READ_ONE} fallback={<NoAccess />}>
      <PromotionEditView id={id} />
    </PermissionGuard>
  );
}
