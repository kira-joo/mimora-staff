import type { Metadata } from "next";
import { PackingSlipPage } from "src/features/orders/print/packing-slip-document";

export const metadata: Metadata = { title: "Packing slip" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PackingSlipPage orderId={id} />;
}
