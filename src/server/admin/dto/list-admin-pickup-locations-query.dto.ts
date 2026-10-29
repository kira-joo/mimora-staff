import { IsBoolean, IsOptional } from "class-validator";
import { BaseFindQueryDto, ToBoolean } from "@kira-joo/backend-toolkit-core";

export class ListAdminPickupLocationsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}
