import { Type } from "class-transformer";
import { Trim } from "@kira-joo/backend-toolkit-core";
import { ArrayMinSize, IsArray, IsIn, IsMongoId, IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";

class ReceiveReturnLineDto {
  @IsMongoId()
  returnLineId!: string;

  @IsIn(["RESTOCK", "DISCARD"])
  disposition!: "RESTOCK" | "DISCARD";

  /** What staff found on inspection (e.g. "unopened", "damaged box") — recorded beside the disposition. */
  @Trim()
  @IsString()
  @IsNotEmpty({ message: "inspectedCondition is required — record what you found when the goods arrived." })
  @MaxLength(200)
  inspectedCondition!: string;
}

export class ReceiveReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveReturnLineDto)
  lines!: ReceiveReturnLineDto[];
}
