import { MaxLimit, ToNumber } from "@kira-joo/backend-toolkit-core";
import { IsInt, IsOptional, Min } from "class-validator";

/** `GET /api/shop/returns` — offset pagination, matching `ListOrdersQueryDto`'s shape. */
export class ListReturnsQueryDto {
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
