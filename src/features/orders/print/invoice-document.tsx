"use client";

import { getApiErrorStatusCode, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { getInvoiceEndpoint, type InvoiceDocument } from "src/api/orders.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { paymentMethodLabel, PAYMENT_STATUS } from "src/features/status/status-vocabulary";
import { PrintMessage, PrintSheet } from "./print-sheet";

/** The printable invoice. Everything on it is the order's own snapshot — see the server's `buildInvoiceView`. */
export function InvoicePage({ orderId }: { orderId: string }) {
  const query = useRequesterQuery({ endpoint: getInvoiceEndpoint, options: { params: { id: orderId } } });
  if (query.isLoading) return <PrintMessage title="Invoice">Loading the invoice…</PrintMessage>;
  if (query.isError || !query.data) {
    return <PrintMessage title="Invoice">{getApiErrorStatusCode(query.error) === 404 ? "This order has no invoice. Orders placed before invoices were introduced are not given one." : "The invoice could not be loaded."}</PrintMessage>;
  }
  return (
    <PrintSheet backHref={AppRoute.ORDER(orderId)} backLabel="Order">
      <InvoiceBody invoice={query.data} />
    </PrintSheet>
  );
}

const date = (format: ReturnType<typeof useStoreFormat>, iso?: string) => format.dateTime(iso);

export function InvoiceBody({ invoice }: { invoice: InvoiceDocument }) {
  const format = useStoreFormat();
  const voided = invoice.status === "VOID";
  const taxLabel = `Tax (${invoice.tax.rate}%)`;

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", gap: "12pt", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "20pt", fontWeight: 600, margin: 0 }}>Invoice</h1>
          <p style={{ margin: "4pt 0 0" }}>
            <span className="st-figure" style={{ fontSize: "14pt", fontWeight: 500 }}>
              {invoice.invoiceNumber}
            </span>
          </p>
        </div>
        {voided ? (
          <div style={{ textAlign: "end" }}>
            <span className="void-mark">VOID</span>
            {invoice.voidedAt ? <p style={{ margin: "6pt 0 0" }}>Cancelled {date(format, invoice.voidedAt)}</p> : null}
          </div>
        ) : null}
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16pt", margin: "16pt 0" }}>
        <div>
          <h2 style={{ fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4pt" }}>From</h2>
          {invoice.seller ? (
            <p style={{ margin: 0 }}>
              <strong dir="auto">{invoice.seller.name.en || invoice.seller.name.ar}</strong>
              {invoice.seller.name.en && invoice.seller.name.ar ? (
                <>
                  <br />
                  <span dir="rtl">{invoice.seller.name.ar}</span>
                </>
              ) : null}
              {invoice.seller.phone ? (
                <>
                  <br />
                  <bdi dir="ltr" className="st-figure">
                    {invoice.seller.phone}
                  </bdi>
                </>
              ) : null}
              {invoice.seller.email ? (
                <>
                  <br />
                  {invoice.seller.email}
                </>
              ) : null}
            </p>
          ) : (
            <p style={{ margin: 0 }}>—</p>
          )}
        </div>
        <div>
          <h2 style={{ fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4pt" }}>Bill to</h2>
          <p style={{ margin: 0 }}>
            <strong dir="auto">{invoice.billTo.name ?? "—"}</strong>
            {invoice.billTo.phone ? (
              <>
                <br />
                <bdi dir="ltr" className="st-figure">
                  {invoice.billTo.phone}
                </bdi>
              </>
            ) : null}
            {invoice.billTo.email ? (
              <>
                <br />
                {invoice.billTo.email}
              </>
            ) : null}
          </p>
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2pt 12pt", margin: 0 }}>
          <dt>Invoice date</dt>
          <dd style={{ margin: 0 }}>{date(format, invoice.issuedAt)}</dd>
          <dt>Order</dt>
          <dd style={{ margin: 0 }} className="st-figure">
            {invoice.orderNumber}
          </dd>
          <dt>Order date</dt>
          <dd style={{ margin: 0 }}>{date(format, invoice.placedAt)}</dd>
        </dl>
        <div>
          <h2 style={{ fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4pt" }}>{invoice.fulfilment.mode === "DELIVERY" ? "Delivered to" : "Collected from"}</h2>
          <p dir="auto" style={{ margin: 0 }}>
            {invoice.fulfilment.address ? (
              <>
                {invoice.fulfilment.address.recipientName}
                <br />
                {[invoice.fulfilment.address.addressLine1, invoice.fulfilment.address.addressLine2, invoice.fulfilment.address.city, invoice.fulfilment.address.governorate].filter(Boolean).join(", ")}
              </>
            ) : invoice.fulfilment.pickupLocation ? (
              <>
                {invoice.fulfilment.pickupLocation.name}
                <br />
                {invoice.fulfilment.pickupLocation.address}
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
      </section>

      {/* On a phone the six columns scroll inside this box rather than widening the page; on paper they never need to. */}
      <div className="overflow-x-auto print:overflow-visible">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>SKU</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Discount</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.lineNumber}>
                <td>
                  <span dir="auto" style={{ fontWeight: 500 }}>
                    {line.productName}
                  </span>
                  {line.variantDescription ? (
                    <span dir="auto" style={{ display: "block", color: "var(--st-ink-muted)" }}>
                      {line.variantDescription}
                    </span>
                  ) : null}
                </td>
                <td className="st-figure" style={{ whiteSpace: "nowrap" }}>
                  {line.sku}
                </td>
                <td className="num">{line.quantity}</td>
                <td className="num">{format.money(line.unitPrice)}</td>
                <td className="num">{Number(line.discount) > 0 ? `−${format.money(line.discount)}` : "—"}</td>
                <td className="num">{format.money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3pt 24pt", maxWidth: "260pt", marginInlineStart: "auto", marginTop: "12pt" }}>
        <dt>Subtotal</dt>
        <dd className="num" style={{ margin: 0 }}>
          {format.money(invoice.subtotal)}
        </dd>
        {Number(invoice.discount) > 0 ? (
          <>
            <dt>Discount{invoice.promotionCode ? ` (${invoice.promotionCode})` : ""}</dt>
            <dd className="num" style={{ margin: 0 }}>
              −{format.money(invoice.discount)}
            </dd>
          </>
        ) : null}
        <dt>Shipping</dt>
        <dd className="num" style={{ margin: 0 }}>
          {Number(invoice.shipping) > 0 ? format.money(invoice.shipping) : "Free"}
        </dd>
        {/* Tax by the mode in force when the order was placed: added on top, or already inside the total. */}
        {invoice.tax.mode === "ADDED" ? (
          <>
            <dt>{taxLabel}</dt>
            <dd className="num" style={{ margin: 0 }}>
              {format.money(invoice.tax.amount)}
            </dd>
          </>
        ) : null}
        <dt style={{ fontWeight: 600, borderTop: "1.5px solid var(--st-ink)", paddingTop: "4pt" }}>Total</dt>
        <dd className="num" style={{ margin: 0, fontWeight: 600, borderTop: "1.5px solid var(--st-ink)", paddingTop: "4pt" }}>
          {format.money(invoice.total)}
        </dd>
        {invoice.tax.mode === "INCLUDED" ? (
          <dd style={{ gridColumn: "1 / -1", margin: 0, color: "var(--st-ink-muted)" }}>
            Includes tax ({invoice.tax.rate}%) of {format.money(invoice.tax.amount)}
          </dd>
        ) : null}
      </dl>

      <section style={{ marginTop: "16pt" }}>
        <h2 style={{ fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4pt" }}>Payment</h2>
        <p style={{ margin: 0 }}>
          {paymentMethodLabel(invoice.payment.method)} · {PAYMENT_STATUS[invoice.payment.status]?.label ?? invoice.payment.status}
        </p>
      </section>

      {invoice.refunds.entries.length > 0 ? (
        <section style={{ marginTop: "16pt" }}>
          <h2 style={{ fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4pt" }}>Refunds recorded</h2>
          <table>
            <tbody>
              {invoice.refunds.entries.map((entry, index) => (
                <tr key={index}>
                  <td>{entry.kind === "RETURN" ? `Return ${entry.returnNumber ?? ""}` : "Payment refund"}</td>
                  <td>{date(format, entry.at)}</td>
                  <td className="st-figure">{entry.reference ?? ""}</td>
                  <td className="num">−{format.money(entry.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ fontWeight: 600 }}>
                  Total refunded
                </td>
                <td className="num" style={{ fontWeight: 600 }}>
                  −{format.money(invoice.refunds.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
