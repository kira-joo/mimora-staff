import { IsBoolean, IsOptional } from "class-validator";
import { BaseFindQueryDto, ToBoolean } from "@kira-joo/backend-toolkit-core";

export class ListAdminPagesQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  published?: boolean;
}
