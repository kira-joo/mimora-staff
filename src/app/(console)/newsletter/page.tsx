import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { NewsletterTable } from "src/features/customers/newsletter-table";

export const metadata: Metadata = { title: "Newsletter" };

export default function NewsletterPage() {
  return (
    <PermissionGuard permission={AppPermission.NEWSLETTER_SUBSCRIBER.READ} fallback={<NoAccess />}>
      <PageShell title="Newsletter" description="Addresses collected for the newsletter, and when each agreed. Nothing is sent from here.">
        <NewsletterTable />
      </PageShell>
    </PermissionGuard>
  );
}
