import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsDefined, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from "class-validator";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";

/** `#RRGGBB` — the one swatch format the storefront renders directly. */
export const SWATCH_HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * One selectable value on an option axis, labelled for both locales so a
 * customer sees "زيتي", not the raw key "olive". The key is what variants
 * store; the label and swatch are display-only and stay editable.
 */
export class OptionAxisValueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  key!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  label!: LocalizedStringDto;

  @IsOptional()
  @Matches(SWATCH_HEX_PATTERN, { message: "swatch must be a #RRGGBB hex colour, e.g. \"#808000\"." })
  swatch?: string;
}

/** An option axis (colour, size): immutable `key`, editable display `name`, optional labelled `values`. */
export class OptionAxisDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  key!: string;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name!: LocalizedStringDto;

  @IsOptional()
  @IsArray()
  @ArrayUnique((value: OptionAxisValueDto) => value.key, { message: "values must not repeat a key." })
  @ValidateNested({ each: true })
  @Type(() => OptionAxisValueDto)
  values?: OptionAxisValueDto[];
}
