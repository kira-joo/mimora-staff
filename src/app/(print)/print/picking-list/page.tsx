import type { Metadata } from "next";
import { PickingListPage } from "src/features/orders/print/picking-list-document";

export const metadata: Metadata = { title: "Picking list" };

/** `?ids=a,b,c` — order ids. Only ids travel in the link; the list is read, and permission-checked, by the API. */
export default async function Page({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const { ids } = await searchParams;
  return <PickingListPage ids={(Array.isArray(ids) ? ids.join(",") : (ids ?? "")).trim()} />;
}
