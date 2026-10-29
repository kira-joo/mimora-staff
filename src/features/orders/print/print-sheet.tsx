"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame every printable document sits in. On screen: a toolbar (back, print) above an A4 sheet. On paper: the
 * sheet alone — the toolbar is `no-print`. `print.css` carries the page size and the print rules.
 */
export function PrintSheet({ backHref, backLabel, children }: { backHref: string; backLabel: string; children: ReactNode }) {
  return (
    <div className="print-canvas">
      <div className="print-toolbar no-print">
        <Link href={backHref} className="inline-flex min-h-[var(--st-tap-min)] items-center font-medium text-[var(--st-accent)] underline underline-offset-2">
          ← {backLabel}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-[var(--st-tap-min)] items-center gap-2 bg-[var(--st-accent)] px-5 font-semibold text-[var(--st-surface)] hover:bg-[var(--st-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--st-focus)]"
        >
          <Printer aria-hidden="true" className="size-4" />
          Print
        </button>
      </div>
      <article className="print-sheet">{children}</article>
    </div>
  );
}

/**
 * A document that could not load says so on the sheet, not as a blank page that prints. `title` is the document's own
 * name: every print page has exactly one h1, loaded or not.
 */
export function PrintMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="print-canvas">
      <div className="print-sheet" style={{ minHeight: 0 }}>
        <h1 style={{ fontSize: "20pt", fontWeight: 600, margin: "0 0 8pt" }}>{title}</h1>
        <p role="alert" style={{ margin: 0 }}>
          {children}
        </p>
      </div>
    </div>
  );
}
