import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from "class-validator";

class CollectionOrderEntryDto {
  @IsMongoId()
  collectionId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderCollectionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CollectionOrderEntryDto)
  items!: CollectionOrderEntryDto[];
}
