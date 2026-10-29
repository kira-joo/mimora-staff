import type { CustomerResetLink } from "src/api/customers.endpoints";

/** The link staff hand over: the backend's full URL when it knows the storefront origin, otherwise the path (staff add the store's own domain). */
export function resetLinkText(link: Pick<CustomerResetLink, "resetUrl" | "resetPath">): string {
  return link.resetUrl ?? link.resetPath;
}
