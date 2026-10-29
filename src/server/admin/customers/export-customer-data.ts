import { MONEY_SCALE, SortOrder, toMoney } from "@kira-joo/toolkit-common";
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import {
  addressRepository,
  consentEventRepository,
  customerRepository,
  newsletterSubscriberRepository,
  orderRepository,
  reviewRepository,
  wishlistRepository,
} from "../../core/repositories";
import { toConsentView } from "../../shop/profile/marketing-consent";

/**
 * Everything personal the store holds about one customer, as JSON
 * (legal-and-consent.md §5: "profile, addresses, orders, reviews and wishlist",
 * plus the consent and newsletter records). Read-only. **Never includes a
 * credential**: no password hash, no token hash or expiry — those are not the
 * customer's data, they are the store's means of verifying them.
 *
 * Orders are a SUMMARY (number, date, status, total, item mode) — the order
 * document is the store's financial record and is available in full from the
 * order screen; guest orders placed with the same phone or email but no account are
 * not linked here, because matching them would be a guess about identity.
 */
export async function exportCustomerData(customerId: string) {
  const customer = await customerRepository.findOne({ where: { _id: customerId }, skipThrowError: true });
  if (!customer) throw new NotFoundError("Customer not found");

  const [addresses, orders, reviews, wishlist, consentEvents, newsletter] = await Promise.all([
    addressRepository.findAll({ where: { customerId: customer._id } }),
    orderRepository.findAll({ where: { customerId: customer._id }, sort: { field: "placedAt", order: SortOrder.DESC } }),
    reviewRepository.findAll({ where: { customerId: customer._id } }),
    wishlistRepository.findAll({ where: { customerId: customer._id } }),
    consentEventRepository.findAll({ where: { customerId: customer._id }, sort: { field: "at", order: SortOrder.ASC } }),
    customer.email ? newsletterSubscriberRepository.findOne({ where: { email: customer.email }, skipThrowError: true }) : Promise.resolve(null),
  ]);

  return {
    exportedAt: new Date(),
    customer: {
      _id: customer._id.toString(),
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? null,
      phoneVerified: customer.phoneVerified,
      emailVerified: customer.emailVerified,
      createdAt: (customer as unknown as { createdAt?: Date }).createdAt,
      updatedAt: (customer as unknown as { updatedAt?: Date }).updatedAt,
      redactedAt: customer.redactedAt ?? null,
    },
    marketingConsent: {
      current: toConsentView(customer.marketingConsent),
      history: consentEvents.map((event) => ({ granted: event.granted, source: event.source, at: event.at })),
    },
    newsletter: newsletter
      ? { status: newsletter.status, locale: newsletter.locale, source: newsletter.source, consentedAt: newsletter.consentedAt, unsubscribedAt: newsletter.unsubscribedAt ?? null }
      : null,
    addresses: addresses.map((address) => ({
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      city: address.city,
      governorate: address.governorate,
      postalCode: address.postalCode ?? null,
      isDefault: address.isDefault,
    })),
    orders: orders.map((order) => ({
      orderNumber: order.orderNumber,
      placedAt: order.placedAt,
      status: order.status,
      paymentStatus: order.payment.status,
      paymentMethod: order.payment.method,
      fulfilmentMode: order.fulfilment.mode,
      total: toMoney(String(order.total)).toFixed(MONEY_SCALE),
    })),
    reviews: reviews.map((review) => ({
      productId: review.productId.toString(),
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status,
      createdAt: (review as unknown as { createdAt?: Date }).createdAt,
    })),
    wishlist: wishlist.map((entry) => ({ productId: entry.productId.toString(), addedAt: (entry as unknown as { createdAt?: Date }).createdAt })),
  };
}
