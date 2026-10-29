import { assertDefaultLocaleComplete } from "./default-locale";
import type { PageSchema } from "./page.schema";

/**
 * D-11 at a page's publication boundary — the legal pages included, whose
 * text a customer accepts at checkout (D-13). Title and content are
 * required in the default locale; SEO text may be blank but not
 * secondary-only.
 */
export async function assertPagePublishable(page: Pick<PageSchema, "title" | "content"> & { seo?: Partial<PageSchema["seo"]> }): Promise<void> {
  await assertDefaultLocaleComplete({ title: page.title, content: page.content, seo: { title: page.seo?.title, description: page.seo?.description } }, (path) => path === "title" || path === "content");
}
