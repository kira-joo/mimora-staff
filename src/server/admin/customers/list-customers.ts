import { escapeRegExp } from "@kira-joo/backend-toolkit-mongoose";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { customerRepository } from "../../core/repositories";
import type { CustomerSchema } from "../../identity/customer.schema";
import type { ListAdminCustomersQueryDto } from "../dto/list-admin-customers-query.dto";

/** CustomerSchema has no `@Searchable()` field, so `search` (name/phone/email) is built here as an explicit `$or`, not delegated to the toolkit's own search handling. */
export async function listCustomers(query: ListAdminCustomersQueryDto): Promise<PaginatedResponse<CustomerSchema>> {
  const { search, ...rest } = query;
  return customerRepository.findAllAndCountPublic({ where: buildCustomerWhere(search), query: rest });
}

/** The list's one filter, shared with the CSV export so a filtered list and its download can never disagree. */
export function buildCustomerWhere(search: string | undefined): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (search?.trim()) {
    const pattern = new RegExp(escapeRegExp(search.trim()), "i");
    where.$or = [{ name: pattern }, { phone: pattern }, { email: pattern }];
  }
  return where;
}
