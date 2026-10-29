import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PromotionsTable } from "src/features/promotions/promotions-table";

export const metadata: Metadata = { title: "Promotions" };

export default function PromotionsPage() {
  return (
    <PermissionGuard permission={AppPermission.PROMOTION.READ} fallback={<NoAccess />}>
      <PageShell title="Promotions" description="Discounts customers get by code or automatically. Only one promotion applies to an order.">
        <PromotionsTable />
      </PageShell>
    </PermissionGuard>
  );
}
