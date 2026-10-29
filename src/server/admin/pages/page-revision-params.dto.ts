import { ToNumber } from "@kira-joo/backend-toolkit-core";
import { IsInt, IsMongoId, Min } from "class-validator";

/** `/api/admin/pages/[id]/revisions/[version]` — a page and one of its versions. */
export class PageRevisionParamsDto {
  @IsMongoId()
  id!: string;

  @ToNumber()
  @IsInt()
  @Min(1)
  version!: number;
}
