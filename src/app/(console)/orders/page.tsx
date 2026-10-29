import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { AppRoute } from "src/common/routes/app-route";
import { ExportCsvButton } from "src/features/exports/export-csv-button";
import { ExpireUnpaidButton } from "src/features/orders/expire-unpaid-button";
import { OrdersTable } from "src/features/orders/orders-table";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <PermissionGuard permission={AppPermission.ORDER.READ} fallback={<NoAccess />}>
      <PageShell title="Orders" description="Every order, newest first. Filter by order and payment status separately; tick orders to print a picking list." actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={AppRoute.ORDERS_BOARD}
              className="inline-flex min-h-[var(--st-tap-min)] items-center gap-2 border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-4 font-medium hover:bg-[var(--st-accent-soft)]"
            >
              <LayoutGrid aria-hidden="true" className="size-4" />
              Board
            </Link>
            <ExportCsvButton kind="orders" readPermission={AppPermission.ORDER.READ} exportPermission={CustomPermission.ORDER_EXPORT} label="Export CSV" />
            <ExpireUnpaidButton />
          </div>
        }
      >
        <OrdersTable />
      </PageShell>
    </PermissionGuard>
  );
}
