import { IsBoolean, IsMongoId, IsOptional } from "class-validator";
import { BaseFindQueryDto, ToBoolean } from "@kira-joo/backend-toolkit-core";

export class ListAdminCategoriesQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  published?: boolean;
}
