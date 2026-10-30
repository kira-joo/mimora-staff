import { MethodType, type Endpoint, type LocalizedString } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";

/**
 * The singleton settings documents. Each is one document per deployment: GET
 * returns the saved document, or its schema defaults before anything was ever
 * saved; PUT writes it. Wire shapes mirror `src/server/admin/dto/update-*.dto.ts`.
 */

/** A stored image: what the store-profile image upload answers and the profile keeps for the logo, favicon, OG image and hero. */
export type StoredImage = ImageAsset;

// --- Store profile ---------------------------------------------------------------------------------------------------

export interface StoreContact {
  phone: string;
  email: string;
  whatsApp?: string;
}

export interface SocialLink {
  platform: string;
  url: string;
}

export interface StoreBrand {
  primary: string;
  accent: string;
  surface: string;
  text: string;
  radiusScale: number;
}

export interface TokenOverride {
  key: "primary" | "accent";
  value: string;
}

export interface StoreTheme {
  defaultGround: "light" | "dark";
  darkEnabled: boolean;
  allowVisitorChoice: boolean;
  tokenOverrides: TokenOverride[];
}

export interface StoreProfile {
  _id: string;
  name: LocalizedString;
  tagline: LocalizedString;
  description: LocalizedString;
  logo?: StoredImage;
  favicon?: StoredImage;
  ogImage?: StoredImage;
  heroMedia?: StoredImage;
  brand?: StoreBrand;
  theme?: StoreTheme;
  /** Absent until first saved: the schema marks it required but a fresh deployment has none. */
  contact?: StoreContact;
  socialLinks?: SocialLink[];
  currency: string;
  defaultLocale: "ar" | "en";
  supportedLocales?: string[];
  /** `ogImage` here is a legacy copy the storefront never reads; the profile's own `ogImage` is the one that counts. */
  defaultSeo?: { title?: LocalizedString; description?: LocalizedString; ogImage?: StoredImage };
  updatedAt?: string;
}

/** `PUT /admin/store-profile` — a partial patch; `brand`/`theme` are not accepted here (see ThemeInput). */
export interface StoreProfileInput {
  name?: LocalizedString;
  tagline?: LocalizedString;
  description?: LocalizedString;
  contact?: StoreContact;
  socialLinks?: SocialLink[];
  currency?: string;
  defaultLocale?: "ar" | "en";
  supportedLocales?: string[];
  defaultSeo?: { title?: LocalizedString; description?: LocalizedString };
  /** An image slot: an asset sets it, `null` removes it (and destroys the stored file), omitted leaves it. */
  logo?: StoredImage | null;
  favicon?: StoredImage | null;
  ogImage?: StoredImage | null;
  heroMedia?: StoredImage | null;
}

const STORE_PROFILE = "/admin/store-profile";

export const getStoreProfileEndpoint: Endpoint<{ returnType: StoreProfile }> = { url: STORE_PROFILE, methodType: MethodType.GET };

export const updateStoreProfileEndpoint: Endpoint<{ body: StoreProfileInput; returnType: StoreProfile }> = {
  url: STORE_PROFILE,
  methodType: MethodType.PUT,
};

// --- Theme -----------------------------------------------------------------------------------------------------------

/** Both objects are required whole — a partial write could leave an override measured against a stale surface. */
export interface ThemeInput {
  brand: StoreBrand;
  theme: StoreTheme;
}

export interface ContrastMeasurement {
  label: string;
  fillHex: string;
  groundHex: string;
  derivedInkHex: string;
  contrastRatio: number;
  meetsMinimum: boolean;
  /** "override" when the pinned override is used as entered on this ground; "derived" when the storefront adjusts it. */
  source: "override" | "derived";
}

export interface UpdateThemeResult {
  profile: StoreProfile;
  /** Measured on the storefront's own light and dark page grounds. */
  contrastReport: { lightGround: ContrastMeasurement[]; darkGround: ContrastMeasurement[] };
}

export const updateThemeEndpoint: Endpoint<{ body: ThemeInput; returnType: UpdateThemeResult }> = {
  url: `${STORE_PROFILE}/theme`,
  methodType: MethodType.PUT,
};

// --- Payment settings ------------------------------------------------------------------------------------------------

export interface PaymentDestination {
  accountName?: string;
  number?: string;
  handle?: string;
}

export interface PaymentMethod {
  method: string;
  enabled?: boolean;
  order?: number;
  instructions?: LocalizedString;
  destination?: PaymentDestination;
  requiresProof?: boolean;
  /** Not editable here (a future online-payment extension point) — carried through unchanged so a save never drops it. */
  requiresProviderIntegration?: boolean;
  autoCancelMinutes?: number;
  verificationWindowMinutes?: number;
}

export interface PaymentSettings {
  methods: PaymentMethod[];
  updatedAt?: string;
}

export interface PaymentSettingsInput {
  methods: PaymentMethod[];
}

const PAYMENT_SETTINGS = "/admin/payment-settings";

export const getPaymentSettingsEndpoint: Endpoint<{ returnType: PaymentSettings }> = { url: PAYMENT_SETTINGS, methodType: MethodType.GET };

export const updatePaymentSettingsEndpoint: Endpoint<{ body: PaymentSettingsInput; returnType: PaymentSettings }> = {
  url: PAYMENT_SETTINGS,
  methodType: MethodType.PUT,
};

// --- Inventory settings ----------------------------------------------------------------------------------------------

export type InventoryPolicy = "DENY" | "CONTINUE_SELLING";

export interface InventorySettings {
  lowStockThreshold: number;
  defaultInventoryPolicy: InventoryPolicy;
  /** Absent until the singleton is first saved. */
  updatedAt?: string;
}

const INVENTORY_SETTINGS = "/admin/inventory-settings";

export const getInventorySettingsEndpoint: Endpoint<{ returnType: InventorySettings }> = { url: INVENTORY_SETTINGS, methodType: MethodType.GET };

export const updateInventorySettingsEndpoint: Endpoint<{ body: Partial<InventorySettings>; returnType: InventorySettings }> = {
  url: INVENTORY_SETTINGS,
  methodType: MethodType.PUT,
};

// --- Notification settings -------------------------------------------------------------------------------------------

export type NotificationChannel = "EMAIL" | "SMS";

export interface NotificationEvent {
  event: string;
  channels: NotificationChannel[];
  recipientRoles: string[];
}

export interface NotificationSettings {
  events: NotificationEvent[];
  /** Absent until the singleton is first saved. */
  updatedAt?: string;
}

const NOTIFICATION_SETTINGS = "/admin/notification-settings";

export const getNotificationSettingsEndpoint: Endpoint<{ returnType: NotificationSettings }> = {
  url: NOTIFICATION_SETTINGS,
  methodType: MethodType.GET,
};

export const updateNotificationSettingsEndpoint: Endpoint<{ body: NotificationSettings; returnType: NotificationSettings }> = {
  url: NOTIFICATION_SETTINGS,
  methodType: MethodType.PUT,
};
