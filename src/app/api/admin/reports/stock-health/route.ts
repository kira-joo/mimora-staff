import { createGetRoute } from "../../../../../server/core/route-factories";
import { StockHealthQueryDto } from "../../../../../server/admin/dto/stock-health-query.dto";
import { getStockHealth } from "../../../../../server/admin/reports/get-stock-health";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.REPORT_READ] },
  query: StockHealthQueryDto,
  handler: async ({ query }) => {
    const report = await getStockHealth(query);
    return report;
  },
});
