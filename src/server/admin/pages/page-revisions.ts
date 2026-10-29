import type { LocalizedString } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";
import type { PageSchema } from "../../content/page.schema";
import type { PageRevisionSchema } from "../../content/page-revision.schema";

export function revisionKey(pageId: mongoose.Types.ObjectId | string, version: number): string {
  return `${pageId.toString()}:${version}`;
}

/** The immutable record of a page's text at its current version. */
export function revisionOf(page: Pick<PageSchema, "_id" | "slug" | "version" | "title" | "content">): Omit<PageRevisionSchema, "_id"> {
  return {
    pageId: page._id,
    slug: page.slug,
    version: page.version,
    revisionKey: revisionKey(page._id, page.version),
    title: { ar: page.title.ar, en: page.title.en },
    content: { ar: page.content.ar, en: page.content.en },
  };
}

export function sameLocalized(a: LocalizedString, b: LocalizedString): boolean {
  return a.ar === b.ar && a.en === b.en;
}
