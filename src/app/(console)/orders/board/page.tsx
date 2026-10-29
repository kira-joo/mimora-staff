import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { OrdersBoard } from "src/features/orders/orders-board";

export const metadata: Metadata = { title: "Orders board" };

export default function OrdersBoardPage() {
  return (
    <PermissionGuard permission={AppPermission.ORDER.READ} fallback={<NoAccess />}>
      <OrdersBoard />
    </PermissionGuard>
  );
}
