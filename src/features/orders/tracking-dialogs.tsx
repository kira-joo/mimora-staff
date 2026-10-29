"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { CustomSelect } from "@kira-joo/frontend-toolkit-tailwind/select";
import { useState } from "react";
import { MAX_TRACKING_NUMBER_LENGTH, validateTrackingNumber } from "src/server/fulfilment/carrier-tracking";

export interface TrackingChoice {
  carrierKey?: string;
  trackingNumber?: string;
}

interface Carrier {
  key: string;
  name: string;
}

/**
 * Carrier + tracking number, checked the way the server checks them: both or neither (on shipping) and a number
 * that is a courier's code. The server is still the authority — it also knows which carriers exist — but a form that
 * waits for a round trip to say "enter the number" is slower than the warehouse needs.
 */
function validate(carrierKey: string | undefined, trackingNumber: string, required: boolean): { carrier?: string; number?: string } {
  const number = trackingNumber.trim();
  if (!required && !carrierKey && !number) return {};
  const problems: { carrier?: string; number?: string } = {};
  if (!carrierKey) problems.carrier = "Choose the carrier this number belongs to.";
  if (!number) problems.number = "Enter the tracking number.";
  else problems.number = validateTrackingNumber(number);
  return problems.carrier || problems.number ? problems : {};
}

function TrackingFields({
  carriers,
  carrierKey,
  trackingNumber,
  errors,
  onCarrier,
  onNumber,
}: {
  carriers: Carrier[];
  carrierKey?: string;
  trackingNumber: string;
  errors: { carrier?: string; number?: string };
  onCarrier: (key: string) => void;
  onNumber: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <CustomSelect<string>
        label="Carrier"
        placeholder="Choose a carrier"
        options={carriers.map((carrier) => ({ value: carrier.key, label: carrier.name }))}
        value={carrierKey}
        error={errors.carrier}
        onChange={(value) => onCarrier(String(value))}
      />
      <CustomInput
        label="Tracking number"
        dir="ltr"
        maxLength={MAX_TRACKING_NUMBER_LENGTH}
        autoComplete="off"
        value={trackingNumber}
        error={errors.number}
        onChange={(event) => onNumber(event.target.value)}
        className="st-figure"
      />
    </div>
  );
}

/** Shown when no carrier is configured: tracking cannot be entered, and saying where to fix that beats a disabled field. */
function NoCarriers() {
  return <p className="text-[14px] text-[var(--st-ink-muted)]">No carriers are set up yet, so a tracking number cannot be entered. Add one under Fulfilment settings.</p>;
}

/** Marking an order shipped: tracking is optional here, but carrier and number come together. */
export function ShipOrderDialog({ orderNumber, carriers, titleId, descriptionId, resolve, dismiss }: DialogContentProps<TrackingChoice> & { orderNumber: string; carriers: Carrier[] }) {
  const [carrierKey, setCarrierKey] = useState<string>();
  const [trackingNumber, setTrackingNumber] = useState("");
  const [errors, setErrors] = useState<{ carrier?: string; number?: string }>({});

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Mark order ${orderNumber} shipped?`}
      description="Add the carrier and tracking number if you have them — you can also add or correct them later. The customer sees the tracking link on their order."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Not yet
          </CustomButton>
          <CustomButton
            onClick={() => {
              const problems = validate(carrierKey, trackingNumber, false);
              setErrors(problems);
              if (problems.carrier || problems.number) return;
              resolve(carrierKey ? { carrierKey, trackingNumber: trackingNumber.trim() } : {});
            }}
          >
            Mark shipped
          </CustomButton>
        </>
      }
    >
      {carriers.length === 0 ? (
        <NoCarriers />
      ) : (
        <TrackingFields
          carriers={carriers}
          carrierKey={carrierKey}
          trackingNumber={trackingNumber}
          errors={errors}
          onCarrier={(key) => {
            setCarrierKey(key);
            setErrors((current) => ({ ...current, carrier: undefined }));
          }}
          onNumber={(value) => {
            setTrackingNumber(value);
            setErrors((current) => ({ ...current, number: undefined }));
          }}
        />
      )}
    </DialogBody>
  );
}

/** Adding or correcting tracking on a shipped order: both fields, always. */
export function EditTrackingDialog({
  orderNumber,
  carriers,
  initial,
  titleId,
  descriptionId,
  resolve,
  dismiss,
}: DialogContentProps<Required<TrackingChoice>> & { orderNumber: string; carriers: Carrier[]; initial?: TrackingChoice }) {
  const [carrierKey, setCarrierKey] = useState(initial?.carrierKey);
  const [trackingNumber, setTrackingNumber] = useState(initial?.trackingNumber ?? "");
  const [errors, setErrors] = useState<{ carrier?: string; number?: string }>({});

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={initial?.trackingNumber ? `Correct tracking for ${orderNumber}` : `Add tracking to ${orderNumber}`}
      description="The change is recorded on the order's timeline with your name. The customer's link updates straight away."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss}>
            Cancel
          </CustomButton>
          <CustomButton
            disabled={carriers.length === 0}
            onClick={() => {
              const problems = validate(carrierKey, trackingNumber, true);
              setErrors(problems);
              if (problems.carrier || problems.number) return;
              resolve({ carrierKey: carrierKey!, trackingNumber: trackingNumber.trim() });
            }}
          >
            Save tracking
          </CustomButton>
        </>
      }
    >
      {carriers.length === 0 ? (
        <NoCarriers />
      ) : (
        <TrackingFields
          carriers={carriers}
          carrierKey={carrierKey}
          trackingNumber={trackingNumber}
          errors={errors}
          onCarrier={(key) => {
            setCarrierKey(key);
            setErrors((current) => ({ ...current, carrier: undefined }));
          }}
          onNumber={(value) => {
            setTrackingNumber(value);
            setErrors((current) => ({ ...current, number: undefined }));
          }}
        />
      )}
    </DialogBody>
  );
}
