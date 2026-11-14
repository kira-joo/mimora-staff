import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsMongoId, Max, Min, ValidateNested } from "class-validator";
import { MAX_CONTENT_ITEMS, MAX_CONTENT_QUANTITY, MIN_CONTENT_QUANTITY } from "../../catalog/product-contents-rules";

class ProductContentItemDto {
  @IsMongoId()
  productId!: string;

  @IsInt()
  @Min(MIN_CONTENT_QUANTITY)
  @Max(MAX_CONTENT_QUANTITY)
  quantity!: number;
}

/** `PUT /admin/products/:id/contents` — the product's whole contents list, in display order. */
export class SetProductContentsDto {
  @IsArray()
  @ArrayMaxSize(MAX_CONTENT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ProductContentItemDto)
  items!: ProductContentItemDto[];
}
