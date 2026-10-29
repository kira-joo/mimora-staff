import { MaxLimit, ToNumber } from "@kira-joo/backend-toolkit-core";
import { IsInt, IsOptional, Min } from "class-validator";

/** `GET /api/shop/orders` — offset pagination, matching `listOrders`'s own `limit`/`offset` shape. */
export class ListOrdersQueryDto {
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
