import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { LocalizedStringDto, ImageAssetDto } from "@kira-joo/backend-toolkit-core";

class ContactDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsOptional()
  @IsString()
  whatsApp?: string;
}

class SocialLinkDto {
  @IsString()
  @IsNotEmpty()
  platform!: string;

  @IsString()
  @IsNotEmpty()
  url!: string;
}

/** Title and description only. The OG image is the profile's own `ogImage` (the field the storefront reads), not a second copy here. */
class SeoDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  title?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description?: LocalizedStringDto;
}

/**
 * `brand`/`theme` are deliberately excluded — StoreProfileSchema's own doc
 * comment reserves write-time contrast validation for a dedicated admin
 * theme-settings route (Batch 32), never a plain field write here. Writing
 * them through this endpoint too would create two unvalidated paths to the
 * same fields.
 *
 * An image slot set to `null` removes it; omitted leaves it. The slots are the images uploaded through
 * `POST /api/admin/media/store-profile-images`.
 */
export class UpdateStoreProfileDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  tagline?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  description?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAssetDto)
  logo?: ImageAssetDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAssetDto)
  favicon?: ImageAssetDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAssetDto)
  ogImage?: ImageAssetDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAssetDto)
  heroMedia?: ImageAssetDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContactDto)
  contact?: ContactDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsIn(["ar", "en"])
  defaultLocale?: "ar" | "en";

  @IsOptional()
  @IsArray()
  @IsIn(["ar", "en"], { each: true })
  supportedLocales?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SeoDto)
  defaultSeo?: SeoDto;
}
