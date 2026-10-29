import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

export interface NewsletterSubscriber {
  _id: string;
  email: string;
  locale: "ar" | "en";
  status: "PENDING" | "SUBSCRIBED" | "UNSUBSCRIBED";
  source: "footer" | "checkout" | "signup" | "account" | "newsletter";
  /** Absent while PENDING: an unconfirmed address has not consented. */
  consentedAt?: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
}

export interface ListNewsletterQuery {
  page?: number;
  limit?: number;
  /** Matches the address. */
  search?: string;
  status?: NewsletterSubscriber["status"];
  sortBy?: string;
  sortOrder?: string;
  [key: string]: unknown;
}

const NEWSLETTER = "/admin/newsletter";

export const listNewsletterEndpoint: Endpoint<{ query: ListNewsletterQuery; returnType: PaginatedResponse<NewsletterSubscriber> }> = {
  url: NEWSLETTER,
  methodType: MethodType.GET,
};

/** Staff unsubscribe an address. The row stays as a suppression, so the public form never re-subscribes it. */
export const unsubscribeNewsletterEndpoint: Endpoint<{ params: { id: string }; returnType: NewsletterSubscriber }> = {
  url: `${NEWSLETTER}/:id/unsubscribe`,
  methodType: MethodType.PUT,
};
