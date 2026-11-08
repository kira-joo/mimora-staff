import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from "class-validator";

/** Far above any real category tree (4 levels); bounds the one `bulkWrite` a request can trigger. */
export const MAX_REORDER_ITEMS = 500;

class CategoryOrderEntryDto {
  @IsMongoId()
  categoryId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REORDER_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CategoryOrderEntryDto)
  items!: CategoryOrderEntryDto[];
}
