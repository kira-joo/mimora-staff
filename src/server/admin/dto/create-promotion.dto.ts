import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  ValidateIf,
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
  minSubtotal?: string;

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
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

class PromotionLimitsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalUses?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perCustomerUses?: number;
}

export class CreatePromotionDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name!: LocalizedStringDto;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description!: LocalizedStringDto;

  @IsIn(["PERCENT", "FIXED", "FREE_SHIPPING"])
  type!: "PERCENT" | "FIXED" | "FREE_SHIPPING";

  /** A decimal string: a percentage (0–100, checked on save) for PERCENT, an amount for FIXED. Not used by FREE_SHIPPING. */
  @ValidateIf((dto: CreatePromotionDto) => dto.type !== "FREE_SHIPPING")
  @IsString()
  @Matches(MONEY_STRING_PATTERN, { message: "value must be a non-negative decimal, e.g. \"15\" or \"49.99\"." })
  value?: string;

  @ValidateNested()
  @Type(() => PromotionConditionsDto)
  conditions!: PromotionConditionsDto;

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
