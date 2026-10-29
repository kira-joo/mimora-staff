import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, revokeAllForSubject, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import { randomBytes } from "node:crypto";
import { consentEventRepository, customerRepository } from "../../core/repositories";
import { AddressModel } from "../../core/address.schema";
import { CartModel } from "../../commerce/cart.schema";
import { CartLineModel } from "../../commerce/cart-line.schema";
import { WishlistModel } from "../../commerce/wishlist.schema";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { NewsletterSubscriberModel } from "../../newsletter/newsletter-subscriber.schema";

/** What the customer's name becomes — also what a moderator sees as the author of their (kept) reviews. */
export const REDACTED_CUSTOMER_NAME = "Deleted customer";

/** The unique, non-personal stand-in for a redacted customer's phone — unique per customer, so the unique index holds, and the real number is free to register again. */
export function redactedPhonePlaceholder(customerId: { toString(): string }): string {
  return `redacted:${customerId.toString()}`;
}

export interface RedactionResult {
  _id: string;
  redactedAt: Date;
}

/**
 * Redacts a customer account (legal-and-consent.md §5; plan #96: "deletion redacts;
 * orders survive as financial records"). **One transaction** — all of it or none, so
 * a failure can never leave a customer half-erased with credentials already revoked,
 * or credentials alive on a customer already anonymised.
 *
 * REDACTED / DESTROYED (the exact list the tests assert):
 *  - `customers`: `name` → a fixed placeholder; `phone` → a unique non-personal
 *    placeholder; `email` unset; `passwordHash` replaced by the hash of a random value
 *    nobody holds; both verification flags false; password-reset and email-verification
 *    token hashes + expiries unset; `tokenVersion` bumped (every access token dies now);
 *    `redactedAt` set; marketing consent recorded as withdrawn.
 *  - `customer_refresh_tokens`: every family revoked.
 *  - `addresses`, `carts` and their `cartlines`, `wishlists`, `newsletterSubscribers`
 *    (by customer link or by the customer's email): DELETED.
 *
 * KEPT, deliberately: every `orders`/`orderlines` document (financial records, and they
 * already snapshot name and address as given at the time), `returns`, `paymentproofs`,
 * `reviews` (they reference the now-redacted shell, so their author reads as
 * "Deleted customer" and nothing links them to a person), `consentevents` (an opaque id
 * with no personal data — the proof that consent was given and withdrawn), and the
 * staff `activitylogs` (which never held the customer's personal data).
 *
 * Not touched and worth knowing: `idempotencyrecords` the customer's actions created
 * expire on their own TTL.
 *
 * Throws `ConflictError` for an already-redacted customer — repeating the act is a
 * mistake worth surfacing, not a silent success.
 */
export async function redactCustomer(customerId: string): Promise<RedactionResult> {
  // Hashing is slow and needs no transaction: done first, so the callback (which a transient conflict may re-run) stays quick and idempotent.
  const unusablePasswordHash = await hashPassword(randomBytes(32).toString("base64url"));

  return withTransaction(async (tx) => {
    const customer = await customerRepository.findOne({ where: { _id: customerId }, skipThrowError: true });
    if (!customer) throw new NotFoundError("Customer not found");
    if (customer.redactedAt) throw new ConflictError("This customer has already been redacted.");

    const now = new Date();
    const session = resolveSession();

    await customerRepository.updateAtomic(
      { _id: customer._id },
      {
        $set: {
          name: REDACTED_CUSTOMER_NAME,
          phone: redactedPhonePlaceholder(customer._id),
          passwordHash: unusablePasswordHash,
          phoneVerified: false,
          emailVerified: false,
          redactedAt: now,
          marketingConsent: { granted: false, at: now, source: "account" },
        },
        $unset: { email: "", passwordResetTokenHash: "", passwordResetExpiresAt: "", emailVerificationTokenHash: "", emailVerificationExpiresAt: "" },
        $inc: { tokenVersion: 1 },
      }
    );
    if (customer.marketingConsent?.granted === true) {
      await consentEventRepository.save({ customerId: customer._id, granted: false, source: "account", at: now });
    }

    await revokeAllForSubject(CustomerRefreshTokenModel, customer._id, session);

    // Multi-row deletes the repository cannot express: direct Model calls, which must pass the ambient session themselves.
    const carts = await CartModel.find({ customerId: customer._id }, { _id: 1 }, { session }).lean();
    await CartLineModel.deleteMany({ cartId: { $in: carts.map((cart) => cart._id) } }, { session });
    await CartModel.deleteMany({ customerId: customer._id }, { session });
    await AddressModel.deleteMany({ customerId: customer._id }, { session });
    await WishlistModel.deleteMany({ customerId: customer._id }, { session });
    await NewsletterSubscriberModel.deleteMany({ $or: [{ customerId: customer._id }, ...(customer.email ? [{ email: customer.email }] : [])] }, { session });

    return tx.complete({ _id: customer._id.toString(), redactedAt: now });
  });
}
