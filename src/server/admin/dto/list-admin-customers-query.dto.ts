import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

/** `search` (inherited) matches name/phone/email — built manually in list-customers.ts since CustomerSchema has no @Searchable() field. */
export class ListAdminCustomersQueryDto extends BaseFindQueryDto {}
