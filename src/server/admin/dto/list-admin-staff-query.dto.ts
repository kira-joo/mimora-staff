import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

/** `search` (inherited) matches name/email — built manually in list-staff.ts since StaffUserSchema has no @Searchable() field. */
export class ListAdminStaffQueryDto extends BaseFindQueryDto {}
