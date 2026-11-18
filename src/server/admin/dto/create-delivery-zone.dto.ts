import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";
import { MONEY_INPUT_PATTERN } from "../../../common/format/money-input";

// The one money pattern (bounded to what a BSON Double stores exactly) — see money-input.ts.
const MONEY_STRING_PATTERN = MONEY_INPUT_PATTERN;

export class CreateDeliveryZoneDto {
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name!: LocalizedStringDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  areas?: string[];

  @Matches(MONEY_STRING_PATTERN, { message: "fee must be a non-negative decimal amount, e.g. \"10.00\"." })
  fee!: string;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "minimumOrder must be a non-negative decimal amount, e.g. \"10.00\"." })
  minimumOrder?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadDays?: number;

  /** The earliest delivery estimate in days; at most `leadDays`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadDaysMin?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}
