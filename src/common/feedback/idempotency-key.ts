import { useRef } from "react";

/** A fresh key for one user action. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One `Idempotency-Key` per user action, REUSED when that same action is retried.
 *
 * Every staff money-moving write needs a key (the API answers 400 without one). A key minted per request would defeat
 * the point: a refund whose response was lost — the staff member sees "Something went wrong", presses Record refund
 * again — must carry the SAME key so the server replays the first result instead of recording a second refund.
 *
 * A key belongs to a `scope`: the action plus its target plus its payload. The same scope reuses the key until
 * `release(scope)` (on success); a different amount, reason or order is a different action and gets a fresh key,
 * so editing a failed form never trips the server's "same key, different request" refusal.
 */
export function createActionKeyRing(generate: () => string = newIdempotencyKey) {
  const keys = new Map<string, string>();
  return {
    keyFor(scope: string): string {
      let key = keys.get(scope);
      if (!key) {
        key = generate();
        keys.set(scope, key);
      }
      return key;
    },
    release(scope: string): void {
      keys.delete(scope);
    },
  };
}

/** The request headers for one action, plus the settle step. Hold one per component; keys live as long as it is mounted. */
export function useActionKeys() {
  const ring = useRef<ReturnType<typeof createActionKeyRing>>(undefined);
  ring.current ??= createActionKeyRing();
  const current = ring.current;
  return {
    headers: (scope: string): Record<string, string> => ({ "Idempotency-Key": current.keyFor(scope) }),
    release: (scope: string) => current.release(scope),
  };
}
