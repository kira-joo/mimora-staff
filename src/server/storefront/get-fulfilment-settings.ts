import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { fulfilmentSettingsRepository } from "../core/repositories";
import type { FulfilmentSettingsSchema } from "../fulfilment/fulfilment-settings.schema";

/**
 * `FulfilmentSettings` singleton — every field on it is storefront-appropriate
 * (switches, lead times, tax mode/rate, shipping-fee mode) EXCEPT `carriers`:
 * the carrier list and its tracking-URL templates are back-office configuration,
 * and the storefront only ever needs the resolved link an order already carries.
 */
export async function getFulfilmentSettings(): Promise<Omit<FulfilmentSettingsSchema, "carriers">> {
  const settings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true, lean: true });
  if (!settings) throw new NotFoundError("Fulfilment settings are not configured.");
  const { carriers: _carriers, ...storefront } = settings;
  return storefront;
}
