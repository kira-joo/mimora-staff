import { IsInt, Min } from "class-validator";

export class UpdateCartLineQuantityDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}
