import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, NotEquals, ValidateNested } from "class-validator";

/** Capped at 100 — enough for a real bulk-edit session (e.g. reconciling a stock count sheet) without one request holding a sequential per-variant write loop open indefinitely. */
const MAX_BULK_ADJUST_ITEMS = 100;

class BulkAdjustStockItemDto {
  @IsMongoId()
  variantId!: string;

  @IsInt()
  @NotEquals(0)
  delta!: number;

  @IsIn(["ADJUSTMENT", "RECEIPT", "DAMAGE"])
  reason!: "ADJUSTMENT" | "RECEIPT" | "DAMAGE";

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;
}

export class BulkAdjustStockDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ADJUST_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => BulkAdjustStockItemDto)
  items!: BulkAdjustStockItemDto[];
}
