import { MaxLimit, ToNumber } from "@kira-joo/backend-toolkit-core";
import { IsInt, IsOptional, Min } from "class-validator";

/** `GET /api/shop/reviews/mine` — offset pagination, matching `ListReturnsQueryDto`'s shape. */
export class ListReviewsQueryDto {
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @MaxLimit()
  limit?: number;

  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(0)
  offset?: number;
}
