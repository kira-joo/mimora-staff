import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import { LocalizedStringDto, ImageAssetDto } from "@kira-joo/backend-toolkit-core";

export class UpdateCategoryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description?: LocalizedStringDto;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  slug?: string;

  /** `null` explicitly moves the category to root; `undefined` (omitted) leaves the parent untouched. */
  @IsOptional()
  @IsMongoId()
  parentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAssetDto)
  /** `null` removes the image. */
  image?: ImageAssetDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  seoTitle?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  seoDescription?: LocalizedStringDto;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
