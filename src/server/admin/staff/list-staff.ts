import { escapeRegExp } from "@kira-joo/backend-toolkit-mongoose";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { staffUserRepository } from "../../core/repositories";
import type { StaffUserSchema } from "../../identity/staff-user.schema";
import type { ListAdminStaffQueryDto } from "../dto/list-admin-staff-query.dto";

/** StaffUserSchema has no `@Searchable()` field, so `search` (name/email) is built here as an explicit `$or`, matching `list-customers.ts`'s own precedent. */
export async function listStaff(query: ListAdminStaffQueryDto): Promise<PaginatedResponse<StaffUserSchema>> {
  const { search, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (search?.trim()) {
    const pattern = new RegExp(escapeRegExp(search.trim()), "i");
    where.$or = [{ name: pattern }, { email: pattern }];
  }

  return staffUserRepository.findAllAndCountPublic({ where, query: rest, relations: ["roles"] });
}
