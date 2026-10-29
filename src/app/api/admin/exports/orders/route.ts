import { createCsvExportRoute } from "../../../../../server/admin/exports/create-csv-export-route";
import { ListAdminOrdersQueryDto } from "../../../../../server/admin/dto/list-admin-orders-query.dto";
import { exportOrders } from "../../../../../server/admin/exports/export-orders";
import { AppPermission, CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

/**
 * CSV of every order, honouring the list's own filters, paged by `_id` with no row cap.
 * Needs the export permission AND the list's read permission (`permissionMode: "all"`):
 * a download is never reachable by a role that cannot see the list. Audited.
 */
export const GET = createCsvExportRoute({
  auth: { permissions: [CustomPermission.ORDER_EXPORT, AppPermission.ORDER.READ], permissionMode: "all" },
  query: ListAdminOrdersQueryDto,
  build: (query) => exportOrders(query),
});
