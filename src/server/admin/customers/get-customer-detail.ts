import { SortOrder } from "@kira-joo/toolkit-common";
import { addressRepository, consentEventRepository, customerRepository, newsletterSubscriberRepository } from "../../core/repositories";
import { toConsentView } from "../../shop/profile/marketing-consent";

/**
 * Profile, addresses, marketing consent (current state plus its recent history)
 * and the newsletter row — order and return history are already served by
 * `GET /api/admin/orders?customerId=X` / `GET /api/admin/returns` (filtered
 * client-side by orderNumber), not duplicated here. `passwordHash` never
 * appears: the schema field itself carries `select: false`, so a plain
 * `findOne` excludes it by default, the same as every other read of this
 * collection.
 */
export async function getCustomerDetailAdmin(customerId: string) {
  const [customer, addresses, consentEvents] = await Promise.all([
    customerRepository.findOne({ where: { _id: customerId } }),
    addressRepository.findAll({ where: { customerId } }),
    consentEventRepository.findAll({ where: { customerId }, sort: { field: "at", order: SortOrder.DESC }, take: 20 }),
  ]);
  const newsletter = customer.email ? await newsletterSubscriberRepository.findOne({ where: { email: customer.email }, skipThrowError: true }) : null;

  return {
    customer,
    addresses,
    marketingConsent: toConsentView(customer.marketingConsent),
    consentEvents: consentEvents.map((event) => ({ _id: event._id.toString(), granted: event.granted, source: event.source, at: event.at })),
    newsletter: newsletter ? { status: newsletter.status, source: newsletter.source, consentedAt: newsletter.consentedAt, unsubscribedAt: newsletter.unsubscribedAt } : null,
  };
}
