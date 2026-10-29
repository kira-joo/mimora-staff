import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PaymentQueue } from "src/features/payments/payment-queue";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <PermissionGuard permission={CustomPermission.PAYMENT_VERIFY} fallback={<NoAccess />}>
      <PageShell title="Payments" description="Transfers waiting for verification, oldest first. Money sits still until each is decided.">
        <PaymentQueue />
      </PageShell>
    </PermissionGuard>
  );
}
