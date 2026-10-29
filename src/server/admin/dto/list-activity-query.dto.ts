import { IsDateString, IsMongoId, IsOptional, IsString, MaxLength } from "class-validator";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

export class ListActivityQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  /** The permission key's entity segment, e.g. `"Product"` or `"Payment"`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsMongoId()
  entityId?: string;

  /** The permission key's action segment, e.g. `"update"` or `"verify"`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
