import { IsEnum, IsIn, IsMongoId, IsOptional } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import { PRODUCT_LIST_SORTS } from "../../catalog/search/product-sort";

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

  /** Default `manual`: the arranged order (`Product.order`, ties newest first). Takes the place of the toolkit's `sortBy`/`sortOrder`, which this list ignores. */
  @IsOptional()
  @IsIn(PRODUCT_LIST_SORTS)
  sort?: (typeof PRODUCT_LIST_SORTS)[number];
}
