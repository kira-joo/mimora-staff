import { ShieldOff } from "lucide-react";

/**
 * The forbidden state: shown when this role lacks the page's permission.
 * Deliberately calm rather than error-styled — nothing went wrong, this
 * account simply doesn't cover it. The API refuses the data regardless.
 */
export function NoAccess({ title = "You don't have access to this page" }: { title?: string }) {
  return (
    <div role="status" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <span className="flex size-11 items-center justify-center border border-[var(--st-line)] bg-[var(--st-surface)] text-[var(--st-ink-muted)]">
        <ShieldOff aria-hidden="true" className="size-5" />
      </span>
      <h1 className="mt-4 text-[20px] font-semibold text-[var(--st-ink)]">{title}</h1>
      <p className="mt-1.5 text-[var(--st-ink-muted)]">Your role doesn&apos;t include it. If you need it for your work, ask an owner to update your role.</p>
    </div>
  );
}
