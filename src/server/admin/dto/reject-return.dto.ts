import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class RejectReturnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
