import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { ImportBatchStatus } from "src/api/catalog-imports.endpoints";
import { TONE_VAR } from "src/features/status/status-vocabulary";

const SPEC = {
  STAGED: { label: "Staged — not live", tone: "pending", icon: Clock },
  PUBLISHED: { label: "Published", tone: "done", icon: CheckCircle2 },
  DISCARDED: { label: "Discarded", tone: "neutral", icon: XCircle },
} as const;

/** Status as colour + icon + word, never colour alone. */
export function ImportStatusSignal({ status }: { status: ImportBatchStatus }) {
  const spec = SPEC[status];
  const Icon = spec.icon;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR[spec.tone] }}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
      {spec.label}
    </span>
  );
}
