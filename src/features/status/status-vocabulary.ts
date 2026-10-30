import {
  Archive,
  Ban,
  Banknote,
  CalendarClock,
  CalendarX2,
  Check,
  CheckCheck,
  Circle,
  Clock,
  FileClock,
  Package,
  PackageCheck,
  PencilLine,
  ShieldCheck,
  Slash,
  Store,
  Route,
  Truck,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus, PaymentStatus } from "src/api/orders.endpoints";
import type { ProductLifecycle } from "src/api/products.endpoints";
import type { ReturnStatus } from "src/api/returns.endpoints";
import type { ReviewStatus } from "src/api/reviews.endpoints";
import type { PromotionStatus } from "src/features/promotions/promotion-status";

/**
 * The learned status vocabulary (design-system §4): every value is colour +
 * icon + label, identical on every surface. Tones resolve to tokens.css
 * `--st-status-*` values, each gated ≥ 4.5:1 on canvas and surface.
 *
 * The document names states the code calls differently; the code wins. Mapped
 * here once: READY_FOR_PICKUP takes the "ready" (dispatched) tone, SHIPPED the
 * "transit" tone (and IN_TRANSIT, the step after it, the same: the parcel is with the courier), COLLECTED — a pickup's
 * DELIVERED — the "done" tone, NOT_REQUIRED (cash on delivery — nothing to verify) the
 * neutral tone.
 */
export type StatusTone = "neutral" | "confirmed" | "processing" | "ready" | "transit" | "done" | "pending" | "refunded" | "danger";

export interface StatusSpec {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
}

export const ORDER_STATUS: Record<OrderStatus, StatusSpec> = {
  PLACED: { label: "Placed", tone: "neutral", icon: Circle },
  CONFIRMED: { label: "Confirmed", tone: "confirmed", icon: Check },
  PROCESSING: { label: "Processing", tone: "processing", icon: Package },
  READY_FOR_PICKUP: { label: "Ready for pickup", tone: "ready", icon: Store },
  SHIPPED: { label: "Shipped", tone: "transit", icon: Truck },
  IN_TRANSIT: { label: "In transit", tone: "transit", icon: Route },
  DELIVERED: { label: "Delivered", tone: "done", icon: CheckCheck },
  COLLECTED: { label: "Collected", tone: "done", icon: PackageCheck },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: Slash },
};

export const PAYMENT_STATUS: Record<PaymentStatus, StatusSpec> = {
  NOT_REQUIRED: { label: "Cash on delivery", tone: "neutral", icon: Banknote },
  AWAITING_PAYMENT: { label: "Awaiting payment", tone: "pending", icon: Clock },
  SUBMITTED: { label: "Proof submitted", tone: "pending", icon: FileClock },
  VERIFIED: { label: "Verified", tone: "done", icon: ShieldCheck },
  REJECTED: { label: "Rejected", tone: "danger", icon: X },
  REFUNDED: { label: "Refunded", tone: "refunded", icon: Undo2 },
};

/** Product lifecycle: only PUBLISHED is on the storefront, so it alone takes a positive tone. */
export const PRODUCT_LIFECYCLE: Record<ProductLifecycle, StatusSpec> = {
  draft: { label: "Draft", tone: "pending", icon: PencilLine },
  published: { label: "Published", tone: "done", icon: Check },
  archived: { label: "Archived", tone: "neutral", icon: Archive },
};

/** Returns: REFUNDED shares the refunded tone with a refunded payment — the same fact, read the same way. */
export const RETURN_STATUS: Record<ReturnStatus, StatusSpec> = {
  REQUESTED: { label: "Requested", tone: "pending", icon: Clock },
  APPROVED: { label: "Approved", tone: "confirmed", icon: Check },
  RECEIVED: { label: "Received", tone: "processing", icon: PackageCheck },
  REJECTED: { label: "Rejected", tone: "danger", icon: X },
  REFUNDED: { label: "Refunded", tone: "refunded", icon: Undo2 },
};

/** Review moderation: only APPROVED reviews reach the storefront. */
export const REVIEW_STATUS: Record<ReviewStatus, StatusSpec> = {
  PENDING: { label: "Pending", tone: "pending", icon: Clock },
  APPROVED: { label: "Approved", tone: "done", icon: Check },
  REJECTED: { label: "Rejected", tone: "danger", icon: X },
};

/** A promotion as a customer would meet it now (`promotionStatus`). Only ACTIVE applies at checkout. */
export const PROMOTION_STATUS: Record<PromotionStatus, StatusSpec> = {
  active: { label: "Active", tone: "done", icon: Check },
  scheduled: { label: "Scheduled", tone: "confirmed", icon: CalendarClock },
  expired: { label: "Expired", tone: "neutral", icon: CalendarX2 },
  exhausted: { label: "Used up", tone: "pending", icon: Ban },
  disabled: { label: "Disabled", tone: "neutral", icon: Slash },
};

export const TONE_VAR: Record<StatusTone, string> = {
  neutral: "var(--st-status-neutral)",
  confirmed: "var(--st-status-confirmed)",
  processing: "var(--st-status-processing)",
  ready: "var(--st-status-ready)",
  transit: "var(--st-status-transit)",
  done: "var(--st-status-done)",
  pending: "var(--st-status-pending)",
  refunded: "var(--st-status-refunded)",
  danger: "var(--st-status-danger)",
};

/** Display names for the payment methods stores configure; anything else reads as its own key, humanized. */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  COD: "Cash on delivery",
  INSTAPAY: "InstaPay",
  VODAFONE_CASH: "Vodafone Cash",
  WALLET_TRANSFER: "Wallet transfer",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABEL[method] ?? method.charAt(0) + method.slice(1).toLowerCase().replace(/_/g, " ");
}
