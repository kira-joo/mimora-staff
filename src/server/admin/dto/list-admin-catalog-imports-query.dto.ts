import { IsIn, IsOptional } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export class ListAdminCatalogImportsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsIn(["STAGED", "PUBLISHED", "DISCARDED"])
  status?: "STAGED" | "PUBLISHED" | "DISCARDED";
}
