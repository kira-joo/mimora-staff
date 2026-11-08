import { customerRepository } from "../../core/repositories";
import { toConsentView, type MarketingConsentView } from "./marketing-consent";
import type { WithTimestamps } from "../../core/with-timestamps";

export interface ProfileView {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  /** The current marketing consent; `{ granted: false }` until the customer opts in. */
  marketingConsent: MarketingConsentView;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fetches the authenticated customer's profile.
 *
 * Returns public profile fields only — no `passwordHash`, no reset tokens.
 */
export async function getProfile(customerId: string): Promise<ProfileView> {
  const customer = await customerRepository.findOne({ where: { _id: customerId }, skipThrowError: true });
  if (!customer) {
    throw new Error("Customer not found");
  }

  return {
    _id: customer._id.toString(),
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    phoneVerified: customer.phoneVerified,
    emailVerified: customer.emailVerified,
    marketingConsent: toConsentView(customer.marketingConsent),
    createdAt: (customer as WithTimestamps<typeof customer>).createdAt,
    updatedAt: (customer as WithTimestamps<typeof customer>).updatedAt,
  };
}
