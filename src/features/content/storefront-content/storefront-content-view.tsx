"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getStorefrontContentEndpoint, saveStorefrontContentDraftEndpoint } from "src/api/storefront-content.endpoints";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { StorefrontContentForm } from "./storefront-content-form";

/**
 * Keyed by the draft and published revisions, so a save or a publish remounts the form on what the server now holds
 * (the same reason the other settings screens key by `updatedAt`).
 */
export function StorefrontContentView() {
  const can = usePermission();
  const query = useRequesterQuery({ endpoint: getStorefrontContentEndpoint });
  return (
    <QueryState query={query} entityName="storefront content">
      {(content) => (
        <PageShell title="Storefront content" description="The announcement bar, navigation and home page sections. Edit a draft, preview it, then publish." maxWidth="3xl">
          <StorefrontContentForm
            key={`${content.draftRevision}:${content.publishedRevision ?? "none"}`}
            endpoint={saveStorefrontContentDraftEndpoint}
            oldData={content}
            canUpdate={can(AppPermission.STOREFRONT_CONTENT.UPDATE)}
            canPublish={can(CustomPermission.STOREFRONT_CONTENT_PUBLISH)}
          />
        </PageShell>
      )}
    </QueryState>
  );
}
