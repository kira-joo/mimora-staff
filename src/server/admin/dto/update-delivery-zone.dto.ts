import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";

const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;

export class UpdateDeliveryZoneDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name?: LocalizedStringDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  areas?: string[];

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "fee must be a non-negative decimal amount, e.g. \"10.00\"." })
  fee?: string;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "minimumOrder must be a non-negative decimal amount, e.g. \"10.00\"." })
  minimumOrder?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadDays?: number;

  /** The earliest delivery estimate in days; at most `leadDays`. null removes it (the window opens at dispatch again). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadDaysMin?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}
