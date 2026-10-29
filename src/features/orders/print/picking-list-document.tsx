"use client";

import { getApiErrorStatusCode, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { getPickingListEndpoint } from "src/api/orders.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { PrintMessage, PrintSheet } from "./print-sheet";

const HEADING = { fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4pt" } as const;

/**
 * The printable picking list for the orders in `ids`: walk the shelves once, pick each SKU's total, then split it
 * back into orders using the references beside it. Aggregated per SKU by the server (`buildPickingList`).
 */
export function PickingListPage({ ids }: { ids: string }) {
  const query = useRequesterQuery({ endpoint: getPickingListEndpoint, options: { query: { ids } }, queryOptions: { enabled: ids.length > 0 } });
  if (!ids) return <PrintMessage title="Picking list">No orders were selected. Tick orders in the order list and choose “Print picking list”.</PrintMessage>;
  if (query.isLoading) return <PrintMessage title="Picking list">Loading the picking list…</PrintMessage>;
  if (query.isError || !query.data) {
    const status = getApiErrorStatusCode(query.error);
    return <PrintMessage title="Picking list">{status === 404 ? "None of the selected orders exist." : status === 400 ? "That selection is not valid — a picking list covers up to 100 orders." : "The picking list could not be loaded."}</PrintMessage>;
  }
  const list = query.data;

  return (
    <PrintSheet backHref={AppRoute.ORDERS} backLabel="Orders">
      <header>
        <h1 style={{ fontSize: "20pt", fontWeight: 600, margin: 0 }}>Picking list</h1>
        <p style={{ margin: "4pt 0 0" }}>
          <span className="st-figure">{list.orderCount}</span> {list.orderCount === 1 ? "order" : "orders"} · <span className="st-figure">{list.totalUnits}</span> {list.totalUnits === 1 ? "unit" : "units"} · <span className="st-figure">{list.items.length}</span> {list.items.length === 1 ? "SKU" : "SKUs"}
        </p>
      </header>

      {list.skipped.length > 0 || list.missing.length > 0 ? (
        <p role="note" style={{ margin: "12pt 0 0", padding: "6pt 8pt", border: "1.5px solid var(--st-status-danger)", color: "var(--st-status-danger)" }}>
          {list.skipped.length > 0 ? (
            <>
              Left off — cancelled, stock already returned: <span className="st-figure">{list.skipped.map((entry) => entry.orderNumber).join(", ")}</span>.{" "}
            </>
          ) : null}
          {list.missing.length > 0 ? <>{list.missing.length} selected {list.missing.length === 1 ? "order was" : "orders were"} not found.</> : null}
        </p>
      ) : null}

      <table style={{ marginTop: "14pt" }}>
        <thead>
          <tr>
            <th style={{ width: "6%" }}>✓</th>
            <th>SKU</th>
            <th>Item</th>
            <th className="num">Pick</th>
            <th>For orders</th>
          </tr>
        </thead>
        <tbody>
          {list.items.map((item) => (
            <tr key={item.sku}>
              <td>
                <span aria-hidden="true" style={{ display: "inline-block", width: "11pt", height: "11pt", border: "1.5px solid var(--st-ink)" }} />
              </td>
              <td className="st-figure" style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
                {item.sku}
              </td>
              <td>
                <span dir="auto">{item.productName}</span>
                {item.variantDescription ? (
                  <span dir="auto" style={{ display: "block", color: "var(--st-ink-muted)" }}>
                    {item.variantDescription}
                  </span>
                ) : null}
              </td>
              <td className="num" style={{ fontSize: "14pt", fontWeight: 600 }}>
                {item.quantity}
              </td>
              <td className="st-figure" style={{ fontSize: "9.5pt" }}>
                {item.orders.map((entry) => `${entry.orderNumber}${item.orders.length > 1 || entry.quantity > 1 ? ` ×${entry.quantity}` : ""}`).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section style={{ marginTop: "16pt" }}>
        <h2 style={HEADING}>Orders on this list</h2>
        <p className="st-figure" style={{ margin: 0 }}>
          {list.orders.map((order) => `${order.orderNumber} (${order.mode === "DELIVERY" ? "delivery" : "pickup"}, ${order.units})`).join(" · ")}
        </p>
      </section>
    </PrintSheet>
  );
}
