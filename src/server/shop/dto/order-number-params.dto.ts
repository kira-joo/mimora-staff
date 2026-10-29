import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsString, MinLength } from "class-validator";

/**
 * DTO for validating the `[orderNumber]` path parameter.
 *
 * `Order.orderNumber` is a formatted string (`ORD-000001`, see
 * `allocate-order-number.ts`), never a number — matches `SlugParamsDto`'s
 * convention rather than inventing a numeric-transform param.
 */
export class OrderNumberParamsDto {
  @IsString()
  @Trim()
  @MinLength(1)
  orderNumber!: string;
}
