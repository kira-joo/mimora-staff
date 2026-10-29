"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { createCustomerResetLinkEndpoint, exportCustomerDataEndpoint, type Customer, type CustomerResetLink } from "src/api/customers.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { usePermission } from "src/features/auth/use-permission";
import { CustomerResetLinkDialog } from "./customer-reset-link-dialog";
import { RedactCustomerDialog } from "./redact-customer-dialog";

/** Saves a JSON document the browser already holds — the data is never written anywhere else. */
function saveJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Privacy and recovery actions on one customer — each behind its own permission (the API checks each again). A
 * redacted customer has nothing left to export or recover, so none is offered.
 */
export function CustomerActions({ customer }: { customer: Customer }) {
  const can = usePermission();
  const { openDialog } = useDialog();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"export" | "reset" | null>(null);
  const canExport = can(CustomPermission.CUSTOMER_EXPORT_DATA);
  const canReset = can(CustomPermission.CUSTOMER_RESET_LINK);
  const canRedact = can(CustomPermission.CUSTOMER_REDACT);

  if (customer.redactedAt || !(canExport || canReset || canRedact)) return null;

  async function exportData() {
    setBusy("export");
    let data: Record<string, unknown> | undefined;
    const ok = await runAction(async () => {
      data = await requester(exportCustomerDataEndpoint, { params: { id: customer._id } });
    });
    setBusy(null);
    if (ok && data) saveJson(`customer-${customer._id}-data.json`, data);
  }

  async function createResetLink() {
    setBusy("reset");
    let link: CustomerResetLink | undefined;
    const ok = await runAction(async () => {
      link = await requester(createCustomerResetLinkEndpoint, { params: { id: customer._id } });
    });
    setBusy(null);
    if (ok && link) await openDialog<typeof CustomerResetLinkDialog, void>({ component: CustomerResetLinkDialog, props: { link, name: customer.name } }).result;
  }

  async function redact() {
    const outcome = await openDialog<typeof RedactCustomerDialog, boolean>({ component: RedactCustomerDialog, props: { customer: { _id: customer._id, name: customer.name } } }).result;
    if (outcome.status === "resolved") await queryClient.invalidateQueries();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canExport ? (
        <CustomButton variant="outline" leftIcon={Download} onClick={exportData} loading={busy === "export"} disabled={busy !== null}>
          Export data
        </CustomButton>
      ) : null}
      {canReset ? (
        <CustomButton variant="outline" leftIcon={KeyRound} onClick={createResetLink} loading={busy === "reset"} disabled={busy !== null}>
          Create reset link
        </CustomButton>
      ) : null}
      {canRedact ? (
        <CustomButton variant="destructive" leftIcon={Trash2} onClick={redact} disabled={busy !== null}>
          Delete customer data
        </CustomButton>
      ) : null}
    </div>
  );
}
