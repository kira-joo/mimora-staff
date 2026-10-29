import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PagesTable } from "src/features/content/pages-table";

export const metadata: Metadata = { title: "Pages" };

export default function ContentPagesPage() {
  return (
    <PermissionGuard permission={AppPermission.PAGE.READ} fallback={<NoAccess />}>
      <PageShell title="Pages" description="About, policies and other content pages. Unpublished pages stay saved but leave the storefront.">
        <PagesTable />
      </PageShell>
    </PermissionGuard>
  );
}
