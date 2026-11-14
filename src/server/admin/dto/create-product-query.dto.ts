import { IsIn, IsOptional } from "class-validator";

/**
 * `POST /admin/products?onSlugTaken=…` — what a slug another product already uses means. The console omits it and
 * gets `suffix` (the form fills the slug from the name, so a reused name must not block). A caller that must never
 * create a second product for one slug — the catalog importer, which may be re-run — sends `reject` and gets a 409.
 */
export class CreateProductQueryDto {
  @IsOptional()
  @IsIn(["suffix", "reject"])
  onSlugTaken?: "suffix" | "reject";
}
