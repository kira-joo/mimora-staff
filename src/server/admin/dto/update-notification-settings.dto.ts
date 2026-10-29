import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsString, ValidateNested } from "class-validator";

class NotificationEventDto {
  @IsString()
  @IsNotEmpty()
  event!: string;

  @IsArray()
  @IsIn(["EMAIL", "SMS"], { each: true })
  channels!: Array<"EMAIL" | "SMS">;

  @IsArray()
  @IsString({ each: true })
  recipientRoles!: string[];
}

export class UpdateNotificationSettingsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NotificationEventDto)
  events!: NotificationEventDto[];
}
