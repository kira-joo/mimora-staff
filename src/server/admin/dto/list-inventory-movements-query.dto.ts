import { IsEnum, IsMongoId, IsOptional } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export const MOVEMENT_REASONS = ["SALE", "RETURN", "ADJUSTMENT", "RECEIPT", "DAMAGE"] as const;

export class ListInventoryMovementsQueryDto extends BaseFindQueryDto {
  /** One variant's full history. */
  @IsOptional()
  @IsMongoId()
  variantId?: string;

  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsEnum(MOVEMENT_REASONS)
  reason?: (typeof MOVEMENT_REASONS)[number];
}
