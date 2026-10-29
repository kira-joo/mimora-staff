import { IsMongoId } from "class-validator";

export class AddressIdParamsDto {
  @IsMongoId()
  id!: string;
}
