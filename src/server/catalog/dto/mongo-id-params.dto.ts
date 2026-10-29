import { IsMongoId } from "class-validator";

/** Shared params DTO for a `[id]` dynamic segment naming a Mongo document id. */
export class MongoIdParamsDto {
  @IsMongoId()
  id!: string;
}

/** Same shape, named `productId` — for `[productId]` segments where `id` would misname what the param actually identifies (e.g. `/reviews/[productId]`, which is not the review's own id). */
export class ProductIdParamsDto {
  @IsMongoId()
  productId!: string;
}
