import { describe, expect, it } from "vitest";
import type { ContentPage } from "src/api/pages.endpoints";
import { mapPageToFormValues, pageToBody } from "./page-values";

describe("page values", () => {
  it("defaults a new page to unpublished with empty pairs", () => {
    expect(mapPageToFormValues()).toEqual({
      slug: "",
      title: { ar: "", en: "" },
      content: { ar: "", en: "" },
      published: false,
      seo: { title: { ar: "", en: "" }, description: { ar: "", en: "" } },
    });
  });
  it("maps a saved page and fills a missing seo", () => {
    const page = { _id: "1", slug: "about", title: { ar: "ع", en: "A" }, content: { ar: "ن", en: "T" }, published: true, seo: {} } as ContentPage;
    const values = mapPageToFormValues(page);
    expect(values.published).toBe(true);
    expect(values.seo.title).toEqual({ ar: "", en: "" });
  });
  it("trims the slug", () => expect(pageToBody({ ...mapPageToFormValues(), slug: "  about " }).slug).toBe("about"));
});
