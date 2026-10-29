import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createPageEndpoint } from "src/api/pages.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { PageForm } from "src/features/content/page-form";

export const metadata: Metadata = { title: "New page" };

export default function NewContentPage() {
  return (
    <PermissionGuard permission={AppPermission.PAGE.CREATE} fallback={<NoAccess />}>
      <PageShell title="New page" backRoute={{ path: AppRoute.PAGES, label: "Pages" }} maxWidth="3xl">
        <PageForm endpoint={createPageEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
