import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from "class-validator";

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
  @ValidateNested({ each: true })
  @Type(() => CategoryOrderEntryDto)
  items!: CategoryOrderEntryDto[];
}
