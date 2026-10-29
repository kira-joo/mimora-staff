import type { ContentPage, ContentPageInput } from "src/api/pages.endpoints";

const EMPTY_TEXT = { ar: "", en: "" };

/** API shape → form values; no page → the create defaults (a new page starts unpublished, like the backend's own default). */
export function mapPageToFormValues(oldData?: ContentPage): ContentPageInput {
  return {
    slug: oldData?.slug ?? "",
    title: oldData?.title ?? EMPTY_TEXT,
    content: oldData?.content ?? EMPTY_TEXT,
    published: oldData?.published ?? false,
    seo: { title: oldData?.seo?.title ?? EMPTY_TEXT, description: oldData?.seo?.description ?? EMPTY_TEXT },
  };
}

/** The slug is a URL segment; surrounding whitespace is never meant (the schema trims it too). */
export function pageToBody(values: ContentPageInput): ContentPageInput {
  return { ...values, slug: values.slug.trim() };
}
