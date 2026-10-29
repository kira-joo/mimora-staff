import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from "class-validator";

class PickupLocationOrderEntryDto {
  @IsMongoId()
  locationId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderPickupLocationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PickupLocationOrderEntryDto)
  items!: PickupLocationOrderEntryDto[];
}
