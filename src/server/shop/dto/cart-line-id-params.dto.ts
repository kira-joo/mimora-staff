import { IsMongoId } from "class-validator";

/**
 * `lineId` is `CartLine`'s own Mongo `_id` since Phase 4B Batch 3's
 * conversion of `CartLine` from an embedded array to a standalone
 * collection — no more separate app-generated UUID.
 */
export class CartLineIdParamsDto {
  @IsMongoId()
  lineId!: string;
}
