import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from "class-validator";

class DeliveryZoneOrderEntryDto {
  @IsMongoId()
  zoneId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderDeliveryZonesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeliveryZoneOrderEntryDto)
  items!: DeliveryZoneOrderEntryDto[];
}
