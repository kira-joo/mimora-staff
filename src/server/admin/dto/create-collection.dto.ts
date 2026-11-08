import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import { LocalizedStringDto, ImageAssetDto } from "@kira-joo/backend-toolkit-core";

export class CreateCollectionDto {
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name!: LocalizedStringDto;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description!: LocalizedStringDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  slug!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAssetDto)
  image?: ImageAssetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAssetDto)
  icon?: ImageAssetDto;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  seoTitle!: LocalizedStringDto;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  seoDescription!: LocalizedStringDto;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
