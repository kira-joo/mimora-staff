import { IsBoolean, IsOptional } from "class-validator";
import { BaseFindQueryDto, ToBoolean } from "@kira-joo/backend-toolkit-core";

export class ListAdminDeliveryZonesQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}
