import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsISO8601, IsMongoId, IsOptional, Min, ValidateNested } from "class-validator";
import { HOME_SECTION_TYPES, LINK_KINDS, STOREFRONT_CONTENT_LIMITS, type HomeSectionType, type LinkKind } from "../../content/storefront-content.types";

/*
 * The request shape for the storefront-content draft. Each home section is
 * its own class, chosen by `type` — and validation runs with
 * `forbidNonWhitelisted`, so a section carrying another type's field is
 * refused, not silently stored. Rules that span fields or items (one hero,
 * and first; a rail's collection exactly when its source is a collection;
 * an announcement window that ends after it starts) are in
 * `assertDraftShape`, which runs on every save.
 *
 * Every required nested field carries `@IsDefined()`: `@ValidateNested()`
 * alone passes an absent value, which would let a hero with no headline
 * through to a 500.
 */

export class LinkTargetDto {
  @IsIn(LINK_KINDS)
  kind!: LinkKind;

  @IsMongoId()
  id!: string;
}

export class AnnouncementDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  message!: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LinkTargetDto)
  target?: LinkTargetDto;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsBoolean()
  enabled!: boolean;
}

export class NavItemDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => LinkTargetDto)
  target!: LinkTargetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  label?: LocalizedStringDto;
}

/** The fallback class for a `type` no section declares — `IsIn` refuses it. */
export class HomeSectionDto {
  @IsIn(HOME_SECTION_TYPES)
  type!: HomeSectionType;
}

export class CampaignHeroSectionDto {
  @IsIn(["campaignHero"])
  type!: "campaignHero";

  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  headline!: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  subline?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  actionLabel?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LinkTargetDto)
  target?: LinkTargetDto;
}

export class CollectionStorySectionDto {
  @IsIn(["collectionStory"])
  type!: "collectionStory";

  @IsMongoId()
  collectionId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  heading?: LocalizedStringDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  body?: LocalizedStringDto;
}

export class ProductRailSectionDto {
  @IsIn(["productRail"])
  type!: "productRail";

  @IsIn(["collection", "newest"])
  source!: "collection" | "newest";

  @IsOptional()
  @IsMongoId()
  collectionId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  heading?: LocalizedStringDto;
}

export class CategoryTilesSectionDto {
  @IsIn(["categoryTiles"])
  type!: "categoryTiles";

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STOREFRONT_CONTENT_LIMITS.categoryTiles)
  @IsMongoId({ each: true })
  categoryIds!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  heading?: LocalizedStringDto;
}

export class EditorialBandSectionDto {
  @IsIn(["editorialBand"])
  type!: "editorialBand";

  @IsMongoId()
  collectionId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  headline!: LocalizedStringDto;
}

export class AssuranceStripSectionDto {
  @IsIn(["assuranceStrip"])
  type!: "assuranceStrip";
}

export type HomeSectionInput =
  | CampaignHeroSectionDto
  | CollectionStorySectionDto
  | ProductRailSectionDto
  | CategoryTilesSectionDto
  | EditorialBandSectionDto
  | AssuranceStripSectionDto;

/** `PUT /api/admin/storefront-content` — the whole draft, replaced. */
export class SaveStorefrontContentDraftDto {
  @IsArray()
  @ArrayMaxSize(STOREFRONT_CONTENT_LIMITS.announcements)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementDto)
  announcements!: AnnouncementDto[];

  @IsArray()
  @ArrayMaxSize(STOREFRONT_CONTENT_LIMITS.headerNavigation)
  @ValidateNested({ each: true })
  @Type(() => NavItemDto)
  headerNavigation!: NavItemDto[];

  @IsArray()
  @ArrayMaxSize(STOREFRONT_CONTENT_LIMITS.footerNavigation)
  @ValidateNested({ each: true })
  @Type(() => NavItemDto)
  footerNavigation!: NavItemDto[];

  @IsArray()
  @ArrayMaxSize(STOREFRONT_CONTENT_LIMITS.homeSections)
  @ValidateNested({ each: true })
  @Type(() => HomeSectionDto, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: "type",
      subTypes: [
        { value: CampaignHeroSectionDto, name: "campaignHero" },
        { value: CollectionStorySectionDto, name: "collectionStory" },
        { value: ProductRailSectionDto, name: "productRail" },
        { value: CategoryTilesSectionDto, name: "categoryTiles" },
        { value: EditorialBandSectionDto, name: "editorialBand" },
        { value: AssuranceStripSectionDto, name: "assuranceStrip" },
      ],
    },
  })
  homeSections!: HomeSectionInput[];
}

/** `POST /api/admin/storefront-content/publish` — the draft revision the merchant previewed. */
export class PublishStorefrontContentDto {
  @IsInt()
  @Min(0)
  draftRevision!: number;
}
