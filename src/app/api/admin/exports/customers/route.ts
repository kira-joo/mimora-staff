import { createCsvExportRoute } from "../../../../../server/admin/exports/create-csv-export-route";
import { ListAdminCustomersQueryDto } from "../../../../../server/admin/dto/list-admin-customers-query.dto";
import { exportCustomers } from "../../../../../server/admin/exports/export-customers";
import { AppPermission, CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

/**
 * CSV of every customer, honouring the list's own filters, paged by `_id` with no row cap.
 * Needs the export permission AND the list's read permission (`permissionMode: "all"`):
 * a download is never reachable by a role that cannot see the list. Audited.
 */
export const GET = createCsvExportRoute({
  auth: { permissions: [CustomPermission.CUSTOMER_EXPORT, AppPermission.CUSTOMER.READ], permissionMode: "all" },
  query: ListAdminCustomersQueryDto,
  build: (query) => exportCustomers(query),
});
