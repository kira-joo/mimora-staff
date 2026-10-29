import { createCsvExportRoute } from "../../../../../server/admin/exports/create-csv-export-route";
import { ListAdminInventoryQueryDto } from "../../../../../server/admin/dto/list-admin-inventory-query.dto";
import { exportInventory } from "../../../../../server/admin/exports/export-inventory";
import { AppPermission, CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

/**
 * CSV of every variant's stock, honouring the list's own filters, paged by `_id` with no row cap.
 * Needs the export permission AND the list's read permission (`permissionMode: "all"`):
 * a download is never reachable by a role that cannot see the list. Audited.
 */
export const GET = createCsvExportRoute({
  auth: { permissions: [CustomPermission.INVENTORY_EXPORT, AppPermission.VARIANT.READ], permissionMode: "all" },
  query: ListAdminInventoryQueryDto,
  build: (query) => exportInventory(query),
});
