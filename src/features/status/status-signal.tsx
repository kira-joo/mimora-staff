import { ORDER_STATUS, PAYMENT_STATUS, PRODUCT_LIFECYCLE, PROMOTION_STATUS, RETURN_STATUS, REVIEW_STATUS, TONE_VAR, type StatusSpec } from "./status-vocabulary";
import type { OrderStatus, PaymentStatus } from "src/api/orders.endpoints";
import type { ProductLifecycle } from "src/api/products.endpoints";
import type { ReturnStatus } from "src/api/returns.endpoints";
import type { ReviewStatus } from "src/api/reviews.endpoints";
import type { PromotionStatus } from "src/features/promotions/promotion-status";

/**
 * One status, as colour + icon + label — never colour alone. Order status and
 * payment status are separate axes and always render as two signals; `axis`
 * names which one for assistive technology.
 */
function Signal({ spec, axis }: { spec: StatusSpec; axis: string }) {
  const Icon = spec.icon;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR[spec.tone] }}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span>
        <span className="sr-only">{axis}: </span>
        {spec.label}
      </span>
    </span>
  );
}

export function OrderStatusSignal({ status }: { status: OrderStatus }) {
  return <Signal spec={ORDER_STATUS[status] ?? { ...ORDER_STATUS.PLACED, label: status }} axis="Order" />;
}

export function PaymentStatusSignal({ status }: { status: PaymentStatus }) {
  return <Signal spec={PAYMENT_STATUS[status] ?? { ...PAYMENT_STATUS.AWAITING_PAYMENT, label: status }} axis="Payment" />;
}

export function ReturnStatusSignal({ status }: { status: ReturnStatus }) {
  return <Signal spec={RETURN_STATUS[status] ?? { ...RETURN_STATUS.REQUESTED, label: status }} axis="Return" />;
}

export function ProductLifecycleSignal({ lifecycle }: { lifecycle: ProductLifecycle }) {
  return <Signal spec={PRODUCT_LIFECYCLE[lifecycle] ?? { ...PRODUCT_LIFECYCLE.draft, label: lifecycle }} axis="Lifecycle" />;
}

export function ReviewStatusSignal({ status }: { status: ReviewStatus }) {
  return <Signal spec={REVIEW_STATUS[status] ?? { ...REVIEW_STATUS.PENDING, label: status }} axis="Review" />;
}

export function PromotionStatusSignal({ status }: { status: PromotionStatus }) {
  return <Signal spec={PROMOTION_STATUS[status]} axis="Promotion" />;
}
