import { Type } from "class-transformer";
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsMongoId,
  ArrayMaxSize,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsDateString,
} from "class-validator";
import { ImageAssetDto, LocalizedStringDto } from "@kira-joo/backend-toolkit-core";
import { OptionAxisDto } from "./option-axis.dto";
import { MAX_PRODUCT_IMAGES } from "../media/media-targets";

class AttributeValueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  key!: string;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  value!: LocalizedStringDto;
}

class AttributeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  key!: string;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name!: LocalizedStringDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeValueDto)
  values!: AttributeValueDto[];
}

export class UpdateProductDto {
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

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  collectionIds?: string[];

  @IsOptional()
  @IsMongoId()
  brandId?: string;

  @IsOptional()
  @IsMongoId()
  sizeGuide?: string;

  /** The product's gallery, in display order; the first is the primary image. Each entry is a stored `ImageAsset` returned by the media upload. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => ImageAssetDto)
  images?: ImageAssetDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionAxisDto)
  optionAxes?: OptionAxisDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeDto)
  attributes?: AttributeDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  seoTitle?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  seoDescription?: LocalizedStringDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsDateString()
  publishAt?: string;
}
