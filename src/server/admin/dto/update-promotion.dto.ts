import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";

const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;

class PromotionConditionsDto {
  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "minSubtotal must be a non-negative decimal amount, e.g. \"10.00\"." })
  minSubtotal?: string | null;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  collections?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  products?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  variants?: string[];

  @IsOptional()
  @IsBoolean()
  firstOrderOnly?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

/** On update, `null` removes a limit (unlimited); omitting it leaves it as it is. */
class PromotionLimitsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalUses?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perCustomerUses?: number | null;
}

export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  /** `null` (or an empty string) removes the code, making the promotion automatic. */
  code?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description?: LocalizedStringDto;

  @IsOptional()
  @IsIn(["PERCENT", "FIXED", "FREE_SHIPPING"])
  type?: "PERCENT" | "FIXED" | "FREE_SHIPPING";

  /** A decimal string; `null` clears it (only valid when the promotion becomes FREE_SHIPPING — checked on save). */
  @IsOptional()
  @IsString()
  @Matches(MONEY_STRING_PATTERN, { message: "value must be a non-negative decimal, e.g. \"15\" or \"49.99\"." })
  value?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromotionConditionsDto)
  conditions?: PromotionConditionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PromotionLimitsDto)
  limits?: PromotionLimitsDto;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
