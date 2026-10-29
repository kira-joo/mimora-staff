import { paymentSettingsRepository } from "../core/repositories";
import type { LocalizedString } from "@kira-joo/toolkit-common";

export interface PaymentMethodView {
  method: string;
  order: number;
  instructions?: LocalizedString;
  destination?: { accountName?: string; number?: string; handle?: string };
  requiresProof: boolean;
}

/**
 * Enabled payment methods, display fields only — MDS §11.1: "never a
 * secret, never an internal note." `destination` (account name/number/
 * handle) is NOT a secret here: it is the information a customer needs to
 * complete a manual transfer (MDS §13: "show destination + exact amount"),
 * the whole point of this route. What IS excluded: `enabled` itself
 * (disabled methods are omitted entirely, not shown-but-marked-off),
 * `requiresProviderIntegration` (an internal routing flag, not something a
 * customer acts on), and `autoCancelMinutes`/`verificationWindowMinutes`
 * (operational timers, not customer-facing content).
 *
 * No document to be "not found" for — an unconfigured store correctly
 * returns an empty list, not a 404 (payment methods are a plural resource,
 * not a singleton document the way `StoreProfile`/`FulfilmentSettings`
 * are).
 */
export async function getPaymentMethods(): Promise<PaymentMethodView[]> {
  const settings = await paymentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  if (!settings) return [];

  return settings.methods
    .filter((method) => method.enabled)
    .sort((a, b) => a.order - b.order)
    .map((method) => ({
      method: method.method,
      order: method.order,
      instructions: method.instructions,
      destination: method.destination,
      requiresProof: method.requiresProof,
    }));
}
