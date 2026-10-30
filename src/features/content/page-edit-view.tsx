"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getPageEndpoint, updatePageEndpoint } from "src/api/pages.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "src/features/catalog/catalog-display";
import { PageForm } from "./page-form";
import { PageHistory } from "./page-history";

/** Keyed by `updatedAt` for the same reason as the promotion form: a stale cached copy must not be what the form keeps. */
export function PageEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getPageEndpoint, options: { params: { id } } });
  const back = { path: AppRoute.PAGES, label: "Pages" };
  return (
    <QueryState query={query} entityName="page" backRoute={back}>
      {(page) => (
        <PageShell
          title={<span dir="auto">{displayName(page.title) || page.slug}</span>}
          description={`Version ${page.version ?? 1} · ${page.published ? "Published" : "Unpublished"}`}
          backRoute={back}
        >
          <PageForm key={page.updatedAt} endpoint={updatePageEndpoint} oldData={page} />
          <PageHistory key={page.version} pageId={page._id} />
        </PageShell>
      )}
    </QueryState>
  );
}
