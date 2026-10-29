import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { MAX_CARRIERS, MAX_URL_TEMPLATE_LENGTH } from "../../fulfilment/carrier-tracking";

const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

class TaxSettingsDto {
  @IsIn(["INCLUDED", "ADDED"])
  mode!: "INCLUDED" | "ADDED";

  @Type(() => Number)
  @Min(0)
  @Max(100)
  rate!: number;
}

/** One carrier. Shape only; the https/`{tracking}` rules and key uniqueness are checked by `carrierListProblems` in the route. */
class CarrierDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,31}$/, { message: "key must be lowercase letters, digits and hyphens (up to 32)." })
  key!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  @MaxLength(MAX_URL_TEMPLATE_LENGTH)
  urlTemplate!: string;
}

export class UpdateFulfilmentSettingsDto {
  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  defaultDispatchLeadDays?: number;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: "cutoffTime must be in HH:mm 24-hour form, e.g. \"18:00\"." })
  cutoffTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDaysAhead?: number;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "orderMinimum must be a non-negative decimal amount, e.g. \"10.00\"." })
  orderMinimum?: string;

  @IsOptional()
  @IsIn(["FLAT", "BY_ZONE"])
  shippingFeeMode?: "FLAT" | "BY_ZONE";

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "flatShippingFee must be a non-negative decimal amount, e.g. \"10.00\"." })
  flatShippingFee?: string;

  @IsOptional()
  @IsBoolean()
  allowGuestCheckout?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TaxSettingsDto)
  tax?: TaxSettingsDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  customerCancelWindowMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  returnWindowDays?: number;

  /** The whole carrier list, replaced as a unit. `[]` removes every carrier. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CARRIERS)
  @ValidateNested({ each: true })
  @Type(() => CarrierDto)
  carriers?: CarrierDto[];
}
