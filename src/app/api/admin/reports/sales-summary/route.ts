import { createGetRoute } from "../../../../../server/core/route-factories";
import { SalesSummaryQueryDto } from "../../../../../server/admin/dto/sales-summary-query.dto";
import { getSalesSummary } from "../../../../../server/admin/reports/get-sales-summary";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.REPORT_READ] },
  query: SalesSummaryQueryDto,
  handler: async ({ query }) => {
    const summary = await getSalesSummary({ ...query, now: new Date() });
    return summary;
  },
});
