import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/** `GET /api/admin/orders/board` — narrows every column at once. Not paginated: each column is capped (`BOARD_COLUMN_LIMIT`). */
export class BoardOrdersQueryDto {
  @IsOptional()
  @IsIn(["DELIVERY", "PICKUP"])
  mode?: "DELIVERY" | "PICKUP";

  /** The same text search as the list (`orderSearchClause`): order number, customer name or phone. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
