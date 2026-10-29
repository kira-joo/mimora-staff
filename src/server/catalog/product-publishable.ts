import { assertDefaultLocaleComplete } from "../content/default-locale";
import type { ProductSchema } from "./product.schema";

type ProductText = Partial<Pick<ProductSchema, "name" | "description" | "optionAxes" | "attributes" | "seoTitle" | "seoDescription">>;

/**
 * D-11 at the product's publication boundary: a product customers can see
 * must carry its name in the store's default locale, and nothing it shows
 * may exist only in the secondary locale. Called wherever a product
 * becomes, or stays, `published` — creation, the lifecycle change, and an
 * edit to a product that is already live.
 */
export async function assertProductPublishable(product: ProductText): Promise<void> {
  const { name, description, optionAxes, attributes, seoTitle, seoDescription } = product;
  await assertDefaultLocaleComplete({ name, description, optionAxes, attributes, seoTitle, seoDescription }, (path) => path === "name");
}
