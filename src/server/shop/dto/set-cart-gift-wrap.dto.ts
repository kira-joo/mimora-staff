import { IsBoolean } from "class-validator";

/** `PUT /api/shop/cart/gift-wrap` — tick or untick gift box & wrapping for the whole order. */
export class SetCartGiftWrapDto {
  @IsBoolean()
  giftWrap!: boolean;
}
