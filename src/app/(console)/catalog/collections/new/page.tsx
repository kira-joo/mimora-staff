import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createCollectionEndpoint } from "src/api/collections.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { CollectionForm } from "src/features/catalog/collections/collection-form";

export const metadata: Metadata = { title: "New collection" };

export default function NewCollectionPage() {
  return (
    <PermissionGuard permission={AppPermission.COLLECTION.CREATE} fallback={<NoAccess />}>
      <PageShell title="New collection" backRoute={{ path: AppRoute.COLLECTIONS, label: "Collections" }} maxWidth="3xl">
        <CollectionForm endpoint={createCollectionEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
