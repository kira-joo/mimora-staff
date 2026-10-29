import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, NotEquals } from "class-validator";

/** RETURN is excluded — that reason is exclusively written by the return-receive flow (Batch 21), never a direct admin adjustment. SALE is excluded — that's order placement's own concern. */
export class AdjustStockDto {
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
