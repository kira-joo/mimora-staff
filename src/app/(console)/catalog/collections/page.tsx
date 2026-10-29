import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CollectionsTable } from "src/features/catalog/collections/collections-table";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage() {
  return (
    <PermissionGuard permission={AppPermission.COLLECTION.READ} fallback={<NoAccess />}>
      <PageShell title="Collections" description="Curated groups of products across categories — a season, a campaign, a capsule.">
        <CollectionsTable />
      </PageShell>
    </PermissionGuard>
  );
}
