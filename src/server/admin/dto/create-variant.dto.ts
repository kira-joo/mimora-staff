import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { ImageAssetDto } from "@kira-joo/backend-toolkit-core";
import { UNITS_OF_MEASURE, type UnitOfMeasure } from "../../catalog/variant.schema";

/** Matches a non-negative decimal amount with up to 2 fraction digits — the same shape `toMoney()` accepts as a string. Precedent: `ListStorefrontProductsQueryDto`. */
const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_STRING_MESSAGE = "must be a non-negative decimal amount, e.g. \"10.00\".";

class OptionValueDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  key!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  value!: string;
}

export class CreateVariantDto {
  @IsMongoId()
  productId!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  sku!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionValueDto)
  optionValues!: OptionValueDto[];

  @Matches(MONEY_STRING_PATTERN, { message: `price ${MONEY_STRING_MESSAGE}` })
  price!: string;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: `compareAtPrice ${MONEY_STRING_MESSAGE}` })
  compareAtPrice?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  length?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsIn(UNITS_OF_MEASURE)
  unitOfMeasure?: UnitOfMeasure;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitsPerSale?: number;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: `costPrice ${MONEY_STRING_MESSAGE}` })
  costPrice?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageAssetDto)
  galleryOverride?: ImageAsset[];

  @IsOptional()
  @IsEnum(["DENY", "CONTINUE_SELLING"])
  backorderPolicy?: "DENY" | "CONTINUE_SELLING";
}
