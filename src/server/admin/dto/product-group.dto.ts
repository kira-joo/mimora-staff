import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from "class-validator";
import { LocalizedStringDto } from "@kira-joo/backend-toolkit-core";
import { MAX_GROUP_MEMBERS } from "../../catalog/product-group-rules";

/** `POST /admin/product-groups` and `PUT /admin/product-groups/:id` — the group's own fields (just its name). */
export class ProductGroupNameDto {
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  name!: LocalizedStringDto;
}

class ProductGroupMemberDto {
  @IsMongoId()
  productId!: string;

  @ValidateNested()
  @Type(() => LocalizedStringDto)
  label!: LocalizedStringDto;
}

/** `PUT /admin/product-groups/:id/members` — the group's whole membership, in display order. */
export class SetProductGroupMembersDto {
  /** The `revision` the editor loaded; a mismatch is a 409. */
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsArray()
  @ArrayMaxSize(MAX_GROUP_MEMBERS)
  @ValidateNested({ each: true })
  @Type(() => ProductGroupMemberDto)
  members!: ProductGroupMemberDto[];
}
