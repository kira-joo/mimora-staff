"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * The frame for every signed-out screen: one card on the console ground,
 * headed like a manifest — a mono label, the screen's title, and the status
 * rail on its reading-start edge. The card settles in once (≤240ms, absent
 * under reduced motion); nothing else on these screens moves.
 */
export function AuthStage({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
        aria-labelledby="auth-title"
        className="relative w-full max-w-[400px] border border-[var(--st-line)] bg-[var(--st-surface)] shadow-[0_1px_2px_rgba(16,21,25,0.06),0_8px_24px_-12px_rgba(16,21,25,0.18)]"
      >
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[var(--st-rail)] bg-[var(--st-accent)]" />
        <header className="border-b border-[var(--st-line)] px-7 pb-5 pt-6">
          <p className="st-figure uppercase tracking-[0.14em] text-[var(--st-ink-muted)]">{eyebrow}</p>
          <h1 id="auth-title" className="mt-2 text-[20px] font-semibold leading-tight text-[var(--st-ink)]">
            {title}
          </h1>
          {description ? <p className="mt-1.5 text-[var(--st-ink-muted)]">{description}</p> : null}
        </header>
        <div className="px-7 py-6">{children}</div>
      </motion.section>
    </main>
  );
}

/** One alert above a form: announced, linked, never colour alone (icon + text). */
export function FormAlert({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.div
      id={id}
      role="alert"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.18 }}
      className="overflow-hidden"
    >
      <p className="mb-4 flex gap-2 border-s-[var(--st-rail)] border-[var(--st-status-danger)] bg-[var(--st-status-danger-soft)] px-3 py-2.5 text-[var(--st-status-danger)]">
        <span aria-hidden="true" className="font-semibold">!</span>
        <span>{children}</span>
      </p>
    </motion.div>
  );
}
