import { IsBoolean, IsMongoId, IsOptional } from "class-validator";
import { BaseFindQueryDto, ToBoolean } from "@kira-joo/backend-toolkit-core";

export class ListAdminVariantsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  discontinued?: boolean;
}
