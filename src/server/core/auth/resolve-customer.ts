import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { verifyAuthToken } from "@kira-joo/backend-toolkit-next";
import { customerRepository } from "../../core/repositories";
import { customerJwtConfig } from "./customer-jwt-config";

export interface CustomerIdentity {
  _id: string;
  name: string;
  phone: string;
  email?: string;
}

/**
 * Verifies a customer access token and resolves the customer it names.
 *
 * A fresh database read on every call, not a claim trusted from the token —
 * the JWT carries only `sub`/`tokenVersion`; `tokenVersion` mismatch (a
 * password change bumps it) invalidates every previously issued token
 * immediately rather than waiting for expiry.
 */
export async function resolveCustomerFromAccessToken(token: string): Promise<CustomerIdentity> {
  const payload = await verifyAuthToken(token, customerJwtConfig());

  const record = await customerRepository.findOne({ where: { _id: payload.sub }, skipThrowError: true });
  if (!record) throw new UnauthorizedError();
  if (record.tokenVersion !== payload.tokenVersion) throw new UnauthorizedError();
  // A redacted account is a shell kept for the records that point at it: it never authenticates again, even if a token somehow outlived the redaction.
  if (record.redactedAt) throw new UnauthorizedError();

  return { _id: record._id.toString(), name: record.name, phone: record.phone, email: record.email };
}
