import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createSizeGuideEndpoint } from "src/api/size-guides.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { SizeGuideForm } from "src/features/catalog/size-guides/size-guide-form";

export const metadata: Metadata = { title: "New size guide" };

export default function NewSizeguidePage() {
  return (
    <PermissionGuard permission={AppPermission.SIZE_GUIDE.CREATE} fallback={<NoAccess />}>
      <PageShell title="New size guide" backRoute={{ path: AppRoute.SIZE_GUIDES, label: "Size guides" }} maxWidth="4xl">
        <SizeGuideForm endpoint={createSizeGuideEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
