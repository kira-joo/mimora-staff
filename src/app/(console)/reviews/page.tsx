import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ReviewsTable } from "src/features/reviews/reviews-table";

export const metadata: Metadata = { title: "Reviews" };

export default function ReviewsPage() {
  return (
    <PermissionGuard permission={AppPermission.REVIEW.READ} fallback={<NoAccess />}>
      <PageShell title="Reviews" description="Approve or reject what customers write. Only approved reviews show on the storefront and count toward a product's rating.">
        <ReviewsTable />
      </PageShell>
    </PermissionGuard>
  );
}
