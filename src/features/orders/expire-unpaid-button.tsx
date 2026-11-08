"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { TimerOff } from "lucide-react";
import { useState } from "react";
import { expireUnpaidOrdersEndpoint, type ExpireUnpaidOrdersResult } from "src/api/orders.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { usePermission } from "src/features/auth/use-permission";
import { expireUnpaidSummary } from "./expire-unpaid-summary";

/**
 * Runs the unpaid-order sweep now: every order still awaiting payment past its method's "auto-cancel after" is
 * cancelled and the stock it held goes back. Nothing runs this sweep on a schedule; this button is its only trigger.
 * Needs Order.transition — it is a bulk cancellation — and the API checks that again.
 */
export function ExpireUnpaidButton() {
  const can = usePermission();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  if (!can(CustomPermission.ORDER_TRANSITION)) return null;

  async function run() {
    const ok = await confirm({
      title: "Cancel unpaid orders past their deadline?",
      description:
        "Every order still awaiting payment for longer than its payment method's auto-cancel time is cancelled, and the stock it reserved is released. Methods with no auto-cancel time set are left alone. This can't be undone.",
      confirmLabel: "Cancel unpaid orders",
    });
    if (!ok) return;

    setRunning(true);
    let result: ExpireUnpaidOrdersResult | undefined;
    const done = await runAction(async () => {
      result = await requester(expireUnpaidOrdersEndpoint, {});
    });
    setRunning(false);
    if (!done || !result) return;

    const summary = expireUnpaidSummary(result);
    if (summary.tone === "warning") toast.warning(summary.message);
    else toast.success(summary.message);
    await queryClient.invalidateQueries();
  }

  return (
    <CustomButton variant="outline" onClick={run} loading={running} disabled={running}>
      <TimerOff aria-hidden="true" className="size-4" />
      Cancel unpaid orders
    </CustomButton>
  );
}
