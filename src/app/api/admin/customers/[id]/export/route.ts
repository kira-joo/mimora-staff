import { createGetRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { exportCustomerData } from "../../../../../../server/admin/customers/export-customer-data";
import { recordActivity } from "../../../../../../server/core/activity/record-activity";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

/**
 * A customer's personal data as JSON (legal-and-consent.md §5). A read, but
 * reading everything about one person is a privileged act of its own, so it
 * needs `Customer.exportData` (not implied by `Customer.readOne`) and is audited
 * explicitly — the route factory audits only mutations. The entry records who
 * exported whose data and when, never the data (no body, and the response is not
 * logged).
 */
export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.CUSTOMER_EXPORT_DATA] },
  params: MongoIdParamsDto,
  handler: async ({ params, user, request }) => {
    const data = await exportCustomerData(params.id);
    await recordActivity({ permissionKey: CustomPermission.CUSTOMER_EXPORT_DATA, user, params: { id: params.id }, request });
    return data;
  },
});
