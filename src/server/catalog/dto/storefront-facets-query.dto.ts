import { IsMongoId, IsOptional, IsString, MaxLength } from "class-validator";

/** Query DTO for `GET /api/storefront/facets` — the same scope filters a listing takes, so counts reflect what the shopper is looking at. */
export class StorefrontFacetsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsMongoId()
  collectionId?: string;
}
