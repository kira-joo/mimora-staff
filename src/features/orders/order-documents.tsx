import { FileText, PackageOpen } from "lucide-react";
import type { OrderDetail } from "src/api/orders.endpoints";
import { AppRoute } from "src/common/routes/app-route";

const LINK =
  "inline-flex min-h-[var(--st-tap-min)] items-center gap-2 border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-4 font-medium text-[var(--st-ink)] hover:bg-[var(--st-accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--st-focus)]";

/**
 * The order's printable documents. They open in a new tab, outside the console shell, ready to print: the packing
 * slip for whoever packs, the invoice (when this order has one — orders placed before invoices existed do not).
 * The routes behind them check Order.readOne; this is only the way in.
 */
export function OrderDocuments({ order }: { order: OrderDetail }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={AppRoute.PRINT_PACKING_SLIP(order._id)} target="_blank" rel="noopener" className={LINK}>
        <PackageOpen aria-hidden="true" className="size-4" />
        Packing slip
      </a>
      {order.invoiceNumber ? (
        <a href={AppRoute.PRINT_INVOICE(order._id)} target="_blank" rel="noopener" className={LINK}>
          <FileText aria-hidden="true" className="size-4" />
          Invoice <span className="st-figure">{order.invoiceNumber}</span>
        </a>
      ) : null}
    </div>
  );
}
