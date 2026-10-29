import { IsEnum, IsMongoId, IsOptional } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export class ListAdminProductsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsMongoId()
  brandId?: string;

  @IsOptional()
  @IsMongoId()
  collectionId?: string;

  @IsOptional()
  @IsEnum(["draft", "published", "archived"])
  lifecycle?: "draft" | "published" | "archived";
}
