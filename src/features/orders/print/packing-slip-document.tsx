"use client";

import { getApiErrorStatusCode, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { getPackingSlipEndpoint } from "src/api/orders.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { paymentMethodLabel } from "src/features/status/status-vocabulary";
import { PrintMessage, PrintSheet } from "./print-sheet";

const HEADING = { fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4pt" } as const;

/** The printable packing slip: what goes in the box and where it goes. No prices, by design — see the server's `buildPackingSlip`. */
export function PackingSlipPage({ orderId }: { orderId: string }) {
  const format = useStoreFormat();
  const query = useRequesterQuery({ endpoint: getPackingSlipEndpoint, options: { params: { id: orderId } } });
  if (query.isLoading) return <PrintMessage title="Packing slip">Loading the packing slip…</PrintMessage>;
  if (query.isError || !query.data) return <PrintMessage title="Packing slip">{getApiErrorStatusCode(query.error) === 404 ? "This order does not exist." : "The packing slip could not be loaded."}</PrintMessage>;
  const slip = query.data;
  const cod = slip.paymentMethod === "COD";

  return (
    <PrintSheet backHref={AppRoute.ORDER(orderId)} backLabel="Order">
      <header style={{ display: "flex", justifyContent: "space-between", gap: "12pt", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "12pt", fontWeight: 600, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Packing slip</h1>
          <p className="doc-number" style={{ margin: "4pt 0 0" }}>
            {slip.orderNumber}
          </p>
        </div>
        <p style={{ margin: 0, textAlign: "end" }}>
          {slip.mode === "DELIVERY" ? "DELIVERY" : "PICKUP"}
          <br />
          <span style={{ color: "var(--st-ink-muted)" }}>Placed {format.dateTime(slip.placedAt)}</span>
          {slip.dispatchBy ? (
            <>
              <br />
              Dispatch by {format.dateTime(slip.dispatchBy)}
            </>
          ) : null}
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16pt", margin: "16pt 0" }}>
        <div>
          <h2 style={HEADING}>{slip.mode === "DELIVERY" ? "Ship to" : "Collected at"}</h2>
          <p dir="auto" style={{ margin: 0 }}>
            {slip.shipTo ? (
              <>
                <strong>{slip.shipTo.recipientName}</strong>
                <br />
                {slip.shipTo.addressLine1}
                {slip.shipTo.addressLine2 ? `, ${slip.shipTo.addressLine2}` : ""}
                <br />
                {slip.shipTo.city}, {slip.shipTo.governorate}
                {slip.shipTo.postalCode ? ` ${slip.shipTo.postalCode}` : ""}
                <br />
                <bdi dir="ltr" className="st-figure">
                  {slip.shipTo.phone}
                </bdi>
              </>
            ) : slip.pickup ? (
              <>
                <strong>{slip.pickup.name}</strong>
                <br />
                {slip.pickup.address}
                <br />
                <bdi dir="ltr" className="st-figure">
                  {slip.pickup.phone}
                </bdi>
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        <div>
          <h2 style={HEADING}>Contact</h2>
          <p style={{ margin: 0 }}>
            <span dir="auto">{slip.contact.name ?? "—"}</span>
            {slip.contact.phone ? (
              <>
                <br />
                <bdi dir="ltr" className="st-figure">
                  {slip.contact.phone}
                </bdi>
              </>
            ) : null}
          </p>
          {/* The method, never an amount: a courier carrying cash on delivery must know to collect. */}
          <p style={{ margin: "8pt 0 0", fontWeight: cod ? 600 : 400 }}>{cod ? "Collect payment on delivery" : `Payment: ${paymentMethodLabel(slip.paymentMethod)}`}</p>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th style={{ width: "6%" }}>✓</th>
            <th>Item</th>
            <th>SKU</th>
            <th className="num">Qty</th>
          </tr>
        </thead>
        <tbody>
          {slip.lines.map((line) => (
            <tr key={line.lineNumber}>
              <td>
                <span aria-hidden="true" style={{ display: "inline-block", width: "11pt", height: "11pt", border: "1.5px solid var(--st-ink)" }} />
              </td>
              <td>
                <span dir="auto" style={{ fontWeight: 500 }}>
                  {line.productName}
                </span>
                {line.variantDescription ? (
                  <span dir="auto" style={{ display: "block" }}>
                    {line.variantDescription}
                  </span>
                ) : null}
              </td>
              <td className="st-figure" style={{ whiteSpace: "nowrap" }}>
                {line.sku}
              </td>
              <td className="num" style={{ fontSize: "13pt", fontWeight: 600 }}>
                {line.quantity}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ fontWeight: 600, borderBottom: 0 }}>
              Total units
            </td>
            <td className="num" style={{ fontWeight: 600, borderBottom: 0 }}>
              {slip.totalUnits}
            </td>
          </tr>
        </tfoot>
      </table>

      {slip.notes ? (
        <section style={{ marginTop: "16pt", border: "1.5px solid var(--st-ink)", padding: "8pt" }}>
          <h2 style={HEADING}>Customer note</h2>
          <p dir="auto" style={{ margin: 0, whiteSpace: "pre-line" }}>
            {slip.notes}
          </p>
        </section>
      ) : null}
    </PrintSheet>
  );
}
