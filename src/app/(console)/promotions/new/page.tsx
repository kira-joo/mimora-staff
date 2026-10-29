import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createPromotionEndpoint } from "src/api/promotions.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { PromotionForm } from "src/features/promotions/promotion-form";

export const metadata: Metadata = { title: "New promotion" };

export default function NewPromotionPage() {
  return (
    <PermissionGuard permission={AppPermission.PROMOTION.CREATE} fallback={<NoAccess />}>
      <PageShell title="New promotion" backRoute={{ path: AppRoute.PROMOTIONS, label: "Promotions" }} maxWidth="3xl">
        <PromotionForm endpoint={createPromotionEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
