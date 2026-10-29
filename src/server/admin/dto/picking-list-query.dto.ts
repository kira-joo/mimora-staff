import { ToArray } from "@kira-joo/backend-toolkit-core";
import { ArrayMaxSize, ArrayMinSize, IsMongoId } from "class-validator";

/** The most orders one picking list covers — a list is printed and carried, and a hundred orders is already a trolley. */
export const PICKING_LIST_MAX_ORDERS = 100;

/** `GET /api/admin/orders/picking-list?ids=a,b,c` (or repeated `ids`). */
export class PickingListQueryDto {
  @ToArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PICKING_LIST_MAX_ORDERS)
  @IsMongoId({ each: true })
  ids!: string[];
}
