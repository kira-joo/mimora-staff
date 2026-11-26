import { ArrayMaxSize, ArrayUnique, IsArray, IsMongoId, IsOptional } from "class-validator";

/** The most products one arrangement may carry. Well above any catalogue this deployment will hold. */
export const MAX_ARRANGED_PRODUCTS = 5000;

/** What is being arranged: a category (with every descendant), a collection, or — with neither — the whole catalogue. At most one. */
export class ProductOrderScopeQueryDto {
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsMongoId()
  collectionId?: string;
}

export class ReorderProductsDto extends ProductOrderScopeQueryDto {
  /** The scope's complete product list in its new order. */
  @IsArray()
  @ArrayMaxSize(MAX_ARRANGED_PRODUCTS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  productIds!: string[];
}
