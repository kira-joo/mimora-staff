import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";

export type ShippingFeeMode = "FLAT" | "BY_ZONE";
export type TaxMode = "INCLUDED" | "ADDED";

export interface Carrier {
  key: string;
  name: string;
  urlTemplate: string;
}

/** Money is a decimal string on the wire; optional until the merchant sets it. */
export interface FulfilmentSettings {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  defaultDispatchLeadDays: number;
  /** Weekdays orders ship on (0 = Sunday … 6 = Saturday); absent means delivery estimates count calendar days. */
  shippingDays?: number[];
  cutoffTime?: string;
  maxDaysAhead: number;
  orderMinimum?: string;
  shippingFeeMode: ShippingFeeMode;
  flatShippingFee?: string;
  allowGuestCheckout: boolean;
  tax: { mode: TaxMode; rate: number };
  customerCancelWindowMinutes: number;
  returnWindowDays: number;
  /** Carriers staff choose when shipping: a name and an https URL template containing `{tracking}`. */
  carriers: Carrier[];
  /** Absent until the singleton is first saved. */
  updatedAt?: string;
}

/** On an update, `null` clears an optional setting: no cutoff, no order minimum, no flat fee, no shipping days. */
export type FulfilmentSettingsInput = Partial<Omit<FulfilmentSettings, "cutoffTime" | "orderMinimum" | "flatShippingFee" | "shippingDays">> & {
  shippingDays?: number[] | null;
  cutoffTime?: string | null;
  orderMinimum?: string | null;
  flatShippingFee?: string | null;
};

export interface HourRange {
  open: string;
  close: string;
}

export interface WeeklyHours {
  /** 0 = Sunday … 6 = Saturday, matching `Date.getDay()`. */
  weekday: number;
  ranges: HourRange[];
}

export interface HoursException {
  /** An ISO instant on read; a date (`YYYY-MM-DD`) or ISO string on write. */
  date: string;
  closed: boolean;
  ranges: HourRange[];
}

export interface OperatingHours {
  weekly: WeeklyHours[];
  exceptions: HoursException[];
  /** Absent until the singleton is first saved. */
  updatedAt?: string;
}

export const getFulfilmentSettingsEndpoint: Endpoint<{ returnType: FulfilmentSettings }> = {
  url: "/admin/fulfilment-settings",
  methodType: MethodType.GET,
};

export const updateFulfilmentSettingsEndpoint: Endpoint<{ body: FulfilmentSettingsInput; returnType: FulfilmentSettings }> = {
  url: "/admin/fulfilment-settings",
  methodType: MethodType.PUT,
};

export const getOperatingHoursEndpoint: Endpoint<{ returnType: OperatingHours }> = {
  url: "/admin/operating-hours",
  methodType: MethodType.GET,
};

export const updateOperatingHoursEndpoint: Endpoint<{ body: OperatingHours; returnType: OperatingHours }> = {
  url: "/admin/operating-hours",
  methodType: MethodType.PUT,
};
