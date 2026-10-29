import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsInt, IsMongoId, IsNotEmpty, IsString, Max, MaxLength, Min } from "class-validator";

/**
 * `POST /api/shop/reviews` — the canonical create-or-edit operation (D-2:
 * no separate PUT/PATCH route). Submitting again for the same product
 * upserts the existing review rather than creating a second one.
 *
 * `title`/`body` are plain strings, not the stored `LocalizedString` shape
 * — a customer writes in one language per submission; the service resolves
 * which locale from `Accept-Language`, matching `place-order.ts`'s
 * precedent.
 */
export class SubmitReviewDto {
  @IsMongoId()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @Trim()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @Trim()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;
}
