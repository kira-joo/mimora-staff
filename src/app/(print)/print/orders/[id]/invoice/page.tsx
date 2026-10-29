import type { Metadata } from "next";
import { InvoicePage } from "src/features/orders/print/invoice-document";

export const metadata: Metadata = { title: "Invoice" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoicePage orderId={id} />;
}
