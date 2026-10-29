import { IsMongoId } from "class-validator";

export class ProductIdParamsDto {
  @IsMongoId()
  productId!: string;
}
