import { IsEnum } from "class-validator";

export class UpdateProductLifecycleDto {
  @IsEnum(["draft", "published", "archived"])
  lifecycle!: "draft" | "published" | "archived";
}
