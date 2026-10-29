import { IsStorePhone, NormalizePhone } from "src/server/core/phone/store-phone";
import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsOptional, IsString, MinLength } from "class-validator";

/** The DELIVERY-mode address on `PUT /api/shop/cart/fulfilment` — the same field set `Order.fulfilment.addressSnapshot` eventually freezes, but here still a mutable draft. */
export class CartFulfilmentAddressDto {
  @IsString()
  @Trim()
  @MinLength(1)
  recipientName!: string;

  @IsString()
  @Trim()
  @NormalizePhone()
  @IsStorePhone()
  phone!: string;

  @IsString()
  @Trim()
  @MinLength(1)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @Trim()
  addressLine2?: string;

  @IsString()
  @Trim()
  @MinLength(1)
  city!: string;

  @IsString()
  @Trim()
  @MinLength(1)
  governorate!: string;

  @IsOptional()
  @IsString()
  @Trim()
  postalCode?: string;
}
