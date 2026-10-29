import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Min } from "class-validator";

export class UpdateInventorySettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @IsIn(["DENY", "CONTINUE_SELLING"])
  defaultInventoryPolicy?: "DENY" | "CONTINUE_SELLING";
}
