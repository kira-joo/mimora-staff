import { IsBoolean, IsIn, IsOptional } from "class-validator";
import { BaseFindQueryDto, ToBoolean } from "@kira-joo/backend-toolkit-core";

export class ListAdminPromotionsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(["PERCENT", "FIXED", "FREE_SHIPPING"])
  type?: "PERCENT" | "FIXED" | "FREE_SHIPPING";
}
