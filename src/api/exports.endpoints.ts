/**
 * CSV downloads (task #89). Not `Endpoint`s: they answer a streamed file, not JSON,
 * so they are fetched by `features/exports/download-csv.ts`, which owns the base
 * (`/api`, the same origin the staff cookies belong to).
 */
export const EXPORT_PATHS = {
  orders: "/admin/exports/orders",
  customers: "/admin/exports/customers",
  inventory: "/admin/exports/inventory",
} as const;

export type ExportKind = keyof typeof EXPORT_PATHS;
