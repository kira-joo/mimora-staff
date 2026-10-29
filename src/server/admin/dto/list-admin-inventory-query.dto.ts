import { IsBoolean, IsMongoId, IsOptional } from "class-validator";
import { BaseFindQueryDto, ToBoolean } from "@kira-joo/backend-toolkit-core";

export class ListAdminInventoryQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  lowStock?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  outOfStock?: boolean;
}
