import type { OrderSchema } from "../../commerce/order.schema";
import { storeTimeZone } from "../../core/config/store-timezone";
import { deliveryZoneRepository, fulfilmentSettingsRepository } from "../../core/repositories";
import { resolveShipping } from "../../engines/shipping/resolve-shipping";
import type { ShippingZoneConfig } from "../../engines/shipping/shipping.types";
import { loadOperatingSchedule } from "../../fulfilment/load-operating-schedule";

/**
 * Mimora's delivery estimate counts from ORDER CONFIRMATION (owner decision, 2026-10-30): the window the customer
 * saw at checkout and that placement saved is provisional, and confirming the order re-dates it from the
 * confirmation instant — the same engine, shipping days, cutoff and zone range, with "placed at" replaced by
 * "confirmed at". It does not wait for a transfer to be verified.
 *
 * Only orders flagged `promiseFromConfirmation` at placement are re-dated, so an order placed before the rule keeps
 * the promise it was given. Confirmation never fails because of the estimate: `null` (keep the provisional promise)
 * when the order is not such a delivery order, the settings or its zone are gone, or the engine cannot resolve.
 * The booking window is not applied here — it limits what a customer may book, and this order is already booked.
 */
export async function confirmationPromise(order: Pick<OrderSchema, "fulfilment">, confirmedAt: Date): Promise<{ dispatchBy: Date; promisedWindow: { from: Date; to: Date } } | null> {
  const fulfilment = order.fulfilment;
  if (fulfilment.mode !== "DELIVERY" || !fulfilment.promiseFromConfirmation) return null;

  const settings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true, lean: true });
  if (!settings) return null;

  let zones: ShippingZoneConfig[] = [];
  let zoneName: string | undefined;
  if (settings.shippingFeeMode === "BY_ZONE") {
    if (!fulfilment.zoneId) return null;
    const zone = await deliveryZoneRepository.findOne({ where: { _id: fulfilment.zoneId }, skipThrowError: true, lean: true });
    if (!zone) return null;
    zoneName = zone.name.en;
    zones = [{ zone: zone.name.en, fee: zone.fee, estimatedDays: zone.leadDays, estimatedDaysMin: zone.leadDaysMin ?? undefined }];
  }

  const result = resolveShipping({
    mode: "DELIVERY",
    zoneName,
    zones,
    // The order is already accepted: a later switch-off of delivery does not un-date it.
    deliveryEnabled: true,
    pickupEnabled: false,
    shippingFeeMode: settings.shippingFeeMode,
    flatShippingFee: settings.flatShippingFee,
    defaultDispatchLeadDays: settings.defaultDispatchLeadDays,
    cutoffTime: settings.cutoffTime,
    placedAt: confirmedAt,
    timeZone: storeTimeZone(),
    operatingHours: await loadOperatingSchedule(),
    maxDaysAhead: Number.MAX_SAFE_INTEGER,
    shippingDays: settings.shippingDays ?? undefined,
  });
  return result.resolvable ? { dispatchBy: result.dispatchBy, promisedWindow: result.promisedWindow } : null;
}
