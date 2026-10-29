import { SortOrder } from "@kira-joo/toolkit-common";
import { customerRepository } from "../../core/repositories";
import { buildCustomerWhere } from "../customers/list-customers";
import type { ListAdminCustomersQueryDto } from "../dto/list-admin-customers-query.dto";
import { pageByIdCursor, type CsvExport } from "./csv";

export const EXPORT_PAGE_SIZE = 500;

export const CUSTOMER_EXPORT_HEADER = ["Customer ID", "Name", "Phone", "Email", "Phone verified", "Email verified", "Marketing consent", "Consent changed at", "Consent source", "Account", "Joined"] as const;

/** Every customer matching the list's search, oldest first by id, in pages — no row cap. */
export function exportCustomers(query: ListAdminCustomersQueryDto): CsvExport {
  const filter = buildCustomerWhere(query.search);
  const pages = pageByIdCursor(
    (after) =>
      customerRepository.findAll({
        where: after ? { ...filter, _id: { $gt: after } } : filter,
        sort: { field: "_id", order: SortOrder.ASC },
        take: EXPORT_PAGE_SIZE,
      }),
    EXPORT_PAGE_SIZE
  );
  return {
    filename: "customers",
    header: CUSTOMER_EXPORT_HEADER,
    rows: (async function* () {
      for await (const page of pages) for (const customer of page) {
        yield [
          customer._id.toString(),
          customer.name,
          customer.phone,
          customer.email,
          customer.phoneVerified,
          customer.emailVerified,
          customer.marketingConsent?.granted === true,
          customer.marketingConsent?.at,
          customer.marketingConsent?.source,
          customer.redactedAt ? "Redacted" : "Active",
          (customer as unknown as { createdAt?: Date }).createdAt,
        ];
      }
    })(),
  };
}
