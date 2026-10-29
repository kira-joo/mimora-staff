import { Check, CircleDot, PackageX, TriangleAlert, type LucideIcon } from "lucide-react";
import { TONE_VAR, type StatusTone } from "src/features/status/status-vocabulary";
import type { StockState } from "./stock-state";

const SPEC: Record<StockState, { label: string; tone: StatusTone; icon: LucideIcon }> = {
  IN_STOCK: { label: "In stock", tone: "done", icon: Check },
  LOW: { label: "Low", tone: "pending", icon: TriangleAlert },
  OUT: { label: "Out of stock", tone: "danger", icon: PackageX },
  AVAILABLE: { label: "Available", tone: "neutral", icon: CircleDot },
};

/** Stock state as colour + icon + label (design-system §5); out of stock is always spelled out. */
export function StockSignal({ state }: { state: StockState }) {
  const { label, tone, icon: Icon } = SPEC[state];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR[tone] }}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
      {label}
    </span>
  );
}
