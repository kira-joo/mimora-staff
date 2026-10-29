import { IsMongoId } from "class-validator";

export class AddToWishlistDto {
  @IsMongoId()
  productId!: string;
}
