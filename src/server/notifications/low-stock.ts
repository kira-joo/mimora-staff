import type mongoose from "mongoose";
import { AppRoute } from "../../common/routes/app-route";
import { inventorySettingsRepository, orderLineRepository, variantRepository } from "../core/repositories";
import { crossedLowStockThreshold } from "../engines/notifications/staff-notification-policy";
import { getSingletonSettings } from "../admin/settings/singleton-settings";
import { afterCommit } from "./after-commit";
import { saveStaffNotification } from "./notify-staff";

export interface StockChange {
  variantId: mongoose.Types.ObjectId;
  /** On-hand stock before the change. */
  before: number;
  /** On-hand stock after it. */
  after: number;
}

/** Raises a notice if the variant just crossed its effective low-stock threshold. Reads current configuration, so it must run after commit. */
async function raiseIfCrossed(change: StockChange): Promise<void> {
  if (change.after >= change.before) return; // stock only ever crosses DOWN into "low"
  const variant = await variantRepository.findOne({ where: { _id: change.variantId }, skipThrowError: true, lean: true });
  if (!variant || variant.discontinued) return; // a discontinued variant will not be reordered — same exclusion as the stock-health report
  const { lowStockThreshold: defaultThreshold } = await getSingletonSettings(inventorySettingsRepository);
  const threshold = variant.lowStockThreshold ?? defaultThreshold;
  if (!crossedLowStockThreshold(change.before, change.after, threshold)) return;

  await saveStaffNotification({
    type: "LOW_STOCK",
    title: change.after <= 0 ? `Out of stock — ${variant.sku}` : `Low stock — ${variant.sku}`,
    body: change.after <= 0 ? "No units left." : `${change.after} left (threshold ${threshold}).`,
    link: AppRoute.INVENTORY,
    entityType: "Variant",
    entityId: variant._id,
  });
}

/** For a stock movement applied by staff or a return: notify after the surrounding transaction commits. */
export async function notifyStockChange(change: StockChange): Promise<void> {
  await afterCommit("low-stock check", () => raiseIfCrossed(change));
}

/**
 * For a placed order: its transaction has already committed, and placement
 * (which this deliberately does not touch) decrements stock inside it. The
 * stock before is reconstructed as the stock now plus what the order took —
 * exact unless another sale lands in the same instant, in which case the
 * worst outcome is a notice one sale early or late, never a lost order.
 */
export async function notifyStockAfterOrder(orderId: mongoose.Types.ObjectId): Promise<void> {
  await afterCommit("low-stock check after order", async () => {
    const lines = await orderLineRepository.findAll({ where: { orderId }, lean: true });
    const taken = new Map<string, { variantId: mongoose.Types.ObjectId; quantity: number }>();
    for (const line of lines) {
      const key = line.variantId.toString();
      taken.set(key, { variantId: line.variantId, quantity: (taken.get(key)?.quantity ?? 0) + line.quantity });
    }
    for (const { variantId, quantity } of taken.values()) {
      const variant = await variantRepository.findOne({ where: { _id: variantId }, skipThrowError: true, lean: true });
      if (!variant) continue;
      await raiseIfCrossed({ variantId, before: variant.stock + quantity, after: variant.stock });
    }
  });
}
