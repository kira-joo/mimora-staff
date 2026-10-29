/*
 * `@Type()` requires `class-transformer`'s runtime type reflection — see
 * `set-cart-fulfilment.dto.ts`'s own doc comment for why this repo imports
 * `reflect-metadata` directly in every DTO module that uses it, rather than
 * relying on `route-factories.ts`'s side-effect import reaching this module
 * graph under Turbopack's chunk-splitting.
 */
import "reflect-metadata";
import { Trim } from "@kira-joo/backend-toolkit-core";
import { Type } from "class-transformer";
import { ArrayMinSize, IsInt, IsMongoId, IsNotEmpty, IsString, Min, MaxLength, ValidateNested } from "class-validator";

/** One requested line within a return request — mirrors `ReturnLineSchema`'s customer-supplied fields exactly. */
export class ReturnLineRequestDto {
  @IsMongoId()
  orderLineId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @Trim()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsString()
  @Trim()
  @IsNotEmpty()
  @MaxLength(500)
  condition!: string;
}

/** `POST /api/shop/returns` — `orderNumber` is a body field; this route is not nested under `/orders/[orderNumber]`. */
export class RequestReturnDto {
  @IsString()
  @Trim()
  @IsNotEmpty()
  orderNumber!: string;

  /** The overall reason logged at request time — distinct from each line's own `reason`. */
  @IsString()
  @Trim()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ValidateNested({ each: true })
  @Type(() => ReturnLineRequestDto)
  @ArrayMinSize(1)
  lines!: ReturnLineRequestDto[];
}
