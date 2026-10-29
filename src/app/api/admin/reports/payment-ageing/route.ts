import { createGetRoute } from "../../../../../server/core/route-factories";
import { getPaymentAgeing } from "../../../../../server/admin/reports/get-payment-ageing";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.REPORT_READ] },
  handler: async () => {
    const report = await getPaymentAgeing(new Date());
    return report;
  },
});
