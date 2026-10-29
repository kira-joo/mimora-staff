import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

export interface Customer {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** Set once the account has been redacted: a shell kept only for the orders that point at it. */
  redactedAt?: string;
}

export interface CustomerAddress {
  _id: string;
  customerId: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  governorate: string;
  postalCode?: string;
  isDefault: boolean;
}

export interface CustomerDetail extends CustomerPrivacy {
  customer: Customer;
  addresses: CustomerAddress[];
}

export interface ListCustomersQuery {
  page?: number;
  limit?: number;
  /** Matches name, phone or email. */
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  [key: string]: unknown;
}

const CUSTOMERS = "/admin/customers";

export const listCustomersEndpoint: Endpoint<{ query: ListCustomersQuery; returnType: PaginatedResponse<Customer> }> = {
  url: CUSTOMERS,
  methodType: MethodType.GET,
};

export const getCustomerEndpoint: Endpoint<{ params: { id: string }; returnType: CustomerDetail }> = {
  url: `${CUSTOMERS}/:id`,
  methodType: MethodType.GET,
};

/* ── Marketing consent, privacy and recovery (legal-and-consent.md §4-5) ─────── */

export type ConsentSource = "signup" | "account" | "checkout" | "newsletter";

export interface ConsentState {
  granted: boolean;
  at?: string;
  source?: ConsentSource;
}

export interface ConsentEvent {
  _id: string;
  granted: boolean;
  source: ConsentSource;
  at: string;
}

export interface CustomerNewsletterState {
  status: "PENDING" | "SUBSCRIBED" | "UNSUBSCRIBED";
  source: string;
  consentedAt?: string;
  unsubscribedAt?: string;
}

/** The customer detail's privacy fields — present on every detail response. */
export interface CustomerPrivacy {
  marketingConsent: ConsentState;
  consentEvents: ConsentEvent[];
  newsletter: CustomerNewsletterState | null;
}

/** Why an account is being redacted — a closed list, because it is written to the audit log, which must hold no personal data. */
export const REDACTION_REASONS = [
  { value: "CUSTOMER_REQUEST", label: "The customer asked" },
  { value: "DUPLICATE_ACCOUNT", label: "Duplicate account" },
  { value: "FRAUD_OR_ABUSE", label: "Fraud or abuse" },
  { value: "OTHER", label: "Another reason" },
] as const;
export type RedactionReason = (typeof REDACTION_REASONS)[number]["value"];

/** The literal the API requires beside the reason. */
export const REDACT_CONFIRMATION = "REDACT";

/** A customer's personal data as JSON; the console saves it as a file. */
export const exportCustomerDataEndpoint: Endpoint<{ params: { id: string }; returnType: Record<string, unknown> }> = {
  url: `${CUSTOMERS}/:id/export`,
  methodType: MethodType.GET,
};

export const redactCustomerEndpoint: Endpoint<{
  params: { id: string };
  body: { reason: RedactionReason; confirm: typeof REDACT_CONFIRMATION };
  returnType: { _id: string; redactedAt: string };
}> = {
  url: `${CUSTOMERS}/:id/redact`,
  methodType: MethodType.POST,
};

/** The reset credential — returned ONCE; only its hash is stored. */
export interface CustomerResetLink {
  _id: string;
  token: string;
  expiresAt: string;
  resetPath: string;
  /** Present when the backend knows the storefront's origin. */
  resetUrl?: string;
}

export const createCustomerResetLinkEndpoint: Endpoint<{ params: { id: string }; returnType: CustomerResetLink }> = {
  url: `${CUSTOMERS}/:id/reset-link`,
  methodType: MethodType.POST,
};
