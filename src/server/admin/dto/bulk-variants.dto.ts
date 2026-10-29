import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";

/** Matches a non-negative decimal amount with up to 2 fraction digits — the shape `toMoney()` accepts as a string. */
const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_STRING_MESSAGE = "must be a non-negative decimal amount, e.g. \"10.00\".";

/** A product's matrix is bounded (three axes, a few dozen values); this also bounds one transaction. */
export const MAX_BULK_VARIANT_ROWS = 100;

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

/** One new variant. The shape `POST /variants` takes, minus the fields the matrix grid does not edit. */
export class BulkCreateVariantRowDto {
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

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: `costPrice ${MONEY_STRING_MESSAGE}` })
  costPrice?: string;

  /** Written as opening stock — a RECEIPT movement, exactly as a single `POST /variants` does. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;
}

export class BulkCreateVariantsDto {
  @IsMongoId()
  productId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_VARIANT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => BulkCreateVariantRowDto)
  rows!: BulkCreateVariantRowDto[];
}

/**
 * One existing variant's inline edit. No `stock`: it moves only through inventory adjustments, which write the
 * movement the log is built from. `compareAtPrice`/`costPrice` of `null` clear the value; omitted leaves it.
 */
export class BulkUpdateVariantRowDto {
  @IsMongoId()
  id!: string;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: `price ${MONEY_STRING_MESSAGE}` })
  price?: string;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: `compareAtPrice ${MONEY_STRING_MESSAGE}` })
  compareAtPrice?: string | null;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: `costPrice ${MONEY_STRING_MESSAGE}` })
  costPrice?: string | null;

  /** `true` takes the variant off sale (the reversible off-switch); `false` restores it. */
  @IsOptional()
  @IsBoolean()
  discontinued?: boolean;
}

export class BulkUpdateVariantsDto {
  @IsMongoId()
  productId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_VARIANT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateVariantRowDto)
  rows!: BulkUpdateVariantRowDto[];
}
