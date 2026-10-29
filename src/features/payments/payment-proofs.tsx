"use client";

import { ExternalLink, ImageOff } from "lucide-react";
import { useState } from "react";
import type { OrderPaymentProof } from "src/api/orders.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { PaymentStatusSignal } from "src/features/status/status-signal";

/**
 * Every receipt the customer submitted for this order, newest first — and they stay viewable after the payment is
 * verified or rejected, which is when a dispute or an audit looks at them. The links come from the order-detail
 * response, minted per request behind the Payment.verify check (a caller without it is sent no proofs at all), and
 * expire after five minutes: reload the order for a fresh one. An <img>, not next/image, so nothing caches a
 * signed URL past its expiry.
 */
export function PaymentProofs({ orderNumber, proofs }: { orderNumber: string; proofs: OrderPaymentProof[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {proofs.map((proof, index) => (
        <li key={proof.proofId} className="flex flex-col gap-2 border-b border-[var(--st-line)] pb-4 last:border-0 last:pb-0">
          <ProofRow orderNumber={orderNumber} proof={proof} latest={index === 0} />
        </li>
      ))}
    </ul>
  );
}

function ProofRow({ orderNumber, proof, latest }: { orderNumber: string; proof: OrderPaymentProof; latest: boolean }) {
  const format = useStoreFormat();
  const [previewFailed, setPreviewFailed] = useState(false);
  const isImage = proof.mimeType.startsWith("image/");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PaymentStatusSignal status={proof.status} />
        <span className="text-[13px] text-[var(--st-ink-muted)]">{format.dateTime(proof.submittedAt)}</span>
      </div>

      {proof.signedUrl ? (
        <a href={proof.signedUrl} target="_blank" rel="noopener noreferrer" className="block border border-[var(--st-line)] bg-[var(--st-canvas)]">
          {latest && isImage && !previewFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proof.signedUrl} alt={`Payment proof for ${orderNumber}`} className="mx-auto max-h-64 w-auto object-contain" onError={() => setPreviewFailed(true)} />
          ) : null}
          <span className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-[var(--st-accent)]">
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span dir="auto" className="min-w-0 truncate">
              Open {proof.filename}
            </span>
          </span>
        </a>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-[var(--st-ink-muted)]">
          <ImageOff aria-hidden="true" className="size-4 shrink-0" />
          {proof.signedUrlUnavailable ? "File storage is not configured, so this proof can't be opened." : "This proof can't be opened right now."}
        </p>
      )}

      {proof.reviewedAt ? (
        <p className="text-[13px] text-[var(--st-ink-muted)]">
          {proof.status === "REJECTED" ? "Rejected" : "Verified"} {format.dateTime(proof.reviewedAt)}
          {proof.reviewedByName ? (
            <>
              {" "}
              by <span dir="auto">{proof.reviewedByName}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {proof.rejectionReason ? (
        <p dir="auto" className="text-[13px]">
          “{proof.rejectionReason}”
        </p>
      ) : null}
    </>
  );
}
