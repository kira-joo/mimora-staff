"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { ArrowDown, ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { runAction } from "src/common/feedback/run-action";

export interface ReorderItem {
  id: string;
  /** Plain text, for the move buttons' accessible names. */
  name: string;
  /** What the row shows; defaults to `name`. Content is often Arabic — render it with `dir="auto"`. */
  label?: ReactNode;
}

export type ReorderDialogProps = DialogContentProps<boolean> & {
  title: string;
  description?: ReactNode;
  items: ReorderItem[];
  /** Sends the whole new order (ids, first to last) to the API's reorder endpoint. */
  save: (orderedIds: string[]) => Promise<unknown>;
};

/** Move `from` one place up or down; out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/**
 * Reorder a short merchandising list with Move up / Move down — keyboard and
 * touch friendly, no drag library. The row glides to its new place so the eye
 * can follow it (`layout`; MotionConfig drops it under reduced motion).
 * Resolves `true` once the server has saved the order.
 */
export function ReorderDialog({ title, description, items, save, titleId, descriptionId, resolve, dismiss, setBusy }: ReorderDialogProps) {
  const [order, setOrder] = useState(items);
  const [saving, setSaving] = useState(false);
  const changed = order.some((item, index) => item.id !== items[index]?.id);

  async function submit() {
    setSaving(true);
    setBusy(true);
    const ok = await runAction(() => save(order.map((item) => item.id)), "Order saved");
    setSaving(false);
    setBusy(false);
    if (ok) resolve(true);
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={title}
      description={description}
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss} disabled={saving}>
            Cancel
          </CustomButton>
          <CustomButton onClick={submit} loading={saving} disabled={!changed}>
            Save order
          </CustomButton>
        </>
      }
    >
      {order.length === 0 ? (
        <p className="text-[var(--st-ink-muted)]">Nothing to reorder.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-[var(--st-line)] rounded-md border border-[var(--st-line)]">
          {order.map((item, index) => (
            <motion.li key={item.id} layout="position" transition={{ duration: 0.18 }} className="flex min-h-12 items-center gap-2 bg-[var(--st-surface)] ps-3 pe-1">
              <span className="st-figure w-6 shrink-0 text-[13px] text-[var(--st-ink-muted)]">{index + 1}</span>
              <span dir="auto" className="min-w-0 flex-1 truncate">
                {item.label ?? item.name}
              </span>
              <CustomButton
                variant="ghost"
                size="icon"
                aria-label={`Move ${item.name} up`}
                disabled={index === 0 || saving}
                onClick={() => setOrder((current) => moveItem(current, index, -1))}
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </CustomButton>
              <CustomButton
                variant="ghost"
                size="icon"
                aria-label={`Move ${item.name} down`}
                disabled={index === order.length - 1 || saving}
                onClick={() => setOrder((current) => moveItem(current, index, 1))}
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </CustomButton>
            </motion.li>
          ))}
        </ol>
      )}
    </DialogBody>
  );
}
