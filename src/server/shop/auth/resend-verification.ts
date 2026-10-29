import { randomBytes } from "node:crypto";
import { customerRepository } from "../../core/repositories";
import { sendVerificationEmail } from "../../core/mail/send-account-emails";
import { VERIFICATION_TOKEN_TTL_MS } from "./customer-auth.constants";
import { hashVerificationToken } from "./hash-verification-token";

/**
 * Mints and sends a fresh email-verification token, replacing any
 * outstanding one (a customer who lost the first email gets a working
 * second link, not two live tokens racing each other).
 *
 * **Always resolves the same way** — no matching customer, no email on
 * file, or an already-verified email all produce the same silent no-op, for
 * the identical enumeration-oracle reason `requestPasswordReset` documents.
 * The caller (the route) always returns one generic empty response.
 */
export async function resendVerificationEmail(email: string): Promise<void> {
  const customer = await customerRepository.findOne({ where: { email }, skipThrowError: true });
  if (!customer || customer.emailVerified) return;

  const token = randomBytes(32).toString("base64url");
  await customerRepository.updateAtomic(
    { _id: customer._id },
    { $set: { emailVerificationTokenHash: hashVerificationToken(token), emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS) } }
  );

  await sendVerificationEmail(email, token);
}
