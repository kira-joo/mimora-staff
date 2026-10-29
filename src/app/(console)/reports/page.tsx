import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PaymentAgeingSection } from "src/features/reports/payment-ageing-section";
import { SalesSummarySection } from "src/features/reports/sales-summary-section";
import { StockHealthSection } from "src/features/reports/stock-health-section";

export const metadata: Metadata = { title: "Reports" };

/** The three MDS §15a reports. Report.read is granted separately — order access does not imply sales figures. */
export default function ReportsPage() {
  return (
    <PermissionGuard permission={CustomPermission.REPORT_READ} fallback={<NoAccess />}>
      <PageShell title="Reports" description="Sales, stock that needs reordering, and payments waiting too long." maxWidth="5xl">
        <div className="flex flex-col gap-6">
          <SalesSummarySection />
          <div className="grid gap-6 lg:grid-cols-2">
            <StockHealthSection />
            <PaymentAgeingSection />
          </div>
        </div>
      </PageShell>
    </PermissionGuard>
  );
}
