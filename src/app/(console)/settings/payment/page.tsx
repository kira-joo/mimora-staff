import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PaymentView } from "src/features/settings/payment-view";

export const metadata: Metadata = { title: "Payment settings" };

export default function PaymentSettingsPage() {
  return (
    <PermissionGuard permission={AppPermission.PAYMENT_SETTINGS.READ} fallback={<NoAccess />}>
      <PaymentView />
    </PermissionGuard>
  );
}
