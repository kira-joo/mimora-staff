import type { SideNavSectionConfig } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { BarChart3, Layers2, Bell, Boxes, Building2, ClipboardList, Clock, Contact, CreditCard, FileText, FileUp, FolderTree, History, Landmark, LayoutTemplate, Layers, Mail, MapPinned, MessageSquareText, Package, PackageCheck, PackageOpen, Palette, Percent, Ruler, ScrollText, ShieldCheck, SlidersHorizontal, Store, Sunrise, Tags, Users } from "lucide-react";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";

/**
 * The console's navigation, in MDS §3 order. An item is shown only to a role
 * that holds its permission, and an empty section disappears (the toolkit's
 * SideNav filters both) — a section a role cannot use is absent, not
 * present-and-forbidden. **This hides UI only**: every page's data comes from
 * an /api/admin route that checks the same permission server-side.
 *
 * Only screens that exist are listed; sections join as they are built.
 */
export const CONSOLE_NAV: SideNavSectionConfig[] = [
  {
    key: "operations",
    label: "Operations",
    items: [
      // Today is "/" and every role lands there; it is listed for those who work orders, who come back to it. Other roles reach it by the logo/URL.
      { key: "today", label: "Today", href: AppRoute.HOME, icon: Sunrise, permission: AppPermission.ORDER.READ, match: "exact" },
      {
        key: "orders",
        label: "Orders",
        href: AppRoute.ORDERS,
        icon: ClipboardList,
        permission: AppPermission.ORDER.READ,
        // The payments queue lives under /orders but is its own item.
        isActive: (pathname) => (pathname === AppRoute.ORDERS || pathname.startsWith(`${AppRoute.ORDERS}/`)) && !pathname.startsWith(AppRoute.PAYMENTS),
      },
      { key: "payments", label: "Payments", href: AppRoute.PAYMENTS, icon: CreditCard, permission: CustomPermission.PAYMENT_VERIFY, match: "prefix" },
      { key: "returns", label: "Returns", href: AppRoute.RETURNS, icon: PackageOpen, permission: AppPermission.RETURN.READ, match: "prefix" },
      {
        key: "inventory",
        label: "Inventory",
        href: AppRoute.INVENTORY,
        icon: Boxes,
        permission: AppPermission.VARIANT.READ,
        // The adjustments log lives under /inventory but is its own item.
        isActive: (pathname) => (pathname === AppRoute.INVENTORY || pathname.startsWith(`${AppRoute.INVENTORY}/`)) && !pathname.startsWith(AppRoute.INVENTORY_ADJUSTMENTS),
      },
      { key: "inventory-adjustments", label: "Adjustments log", href: AppRoute.INVENTORY_ADJUSTMENTS, icon: ScrollText, permission: AppPermission.STOCK_MOVEMENT.READ, match: "prefix" },
    ],
  },
  {
    key: "catalog",
    label: "Catalog",
    items: [
      { key: "products", label: "Products", href: AppRoute.PRODUCTS, icon: Package, permission: AppPermission.PRODUCT.READ, match: "prefix" },
      { key: "product-groups", label: "Product groups", href: AppRoute.PRODUCT_GROUPS, icon: Layers2, permission: AppPermission.PRODUCT_GROUP.READ, match: "prefix" },
      { key: "categories", label: "Categories", href: AppRoute.CATEGORIES, icon: FolderTree, permission: AppPermission.CATEGORY.READ, match: "prefix" },
      { key: "collections", label: "Collections", href: AppRoute.COLLECTIONS, icon: Layers, permission: AppPermission.COLLECTION.READ, match: "prefix" },
      { key: "brands", label: "Brands", href: AppRoute.BRANDS, icon: Tags, permission: AppPermission.BRAND.READ, match: "prefix" },
      { key: "catalog-imports", label: "Bulk import", href: AppRoute.CATALOG_IMPORTS, icon: FileUp, permission: AppPermission.CATALOG_IMPORT_BATCH.READ, match: "prefix" },
      { key: "size-guides", label: "Size guides", href: AppRoute.SIZE_GUIDES, icon: Ruler, permission: AppPermission.SIZE_GUIDE.READ, match: "prefix" },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    items: [
      { key: "customers", label: "Customers", href: AppRoute.CUSTOMERS, icon: Contact, permission: AppPermission.CUSTOMER.READ, match: "prefix" },
      { key: "reviews", label: "Reviews", href: AppRoute.REVIEWS, icon: MessageSquareText, permission: AppPermission.REVIEW.READ, match: "prefix" },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    items: [
      { key: "newsletter", label: "Newsletter", href: AppRoute.NEWSLETTER, icon: Mail, permission: AppPermission.NEWSLETTER_SUBSCRIBER.READ, match: "prefix" },
      { key: "promotions", label: "Promotions", href: AppRoute.PROMOTIONS, icon: Percent, permission: AppPermission.PROMOTION.READ, match: "prefix" },
      { key: "pages", label: "Pages", href: AppRoute.PAGES, icon: FileText, permission: AppPermission.PAGE.READ, match: "prefix" },
      { key: "storefront-content", label: "Storefront content", href: AppRoute.STOREFRONT_CONTENT, icon: LayoutTemplate, permission: AppPermission.STOREFRONT_CONTENT.READ, match: "prefix" },
    ],
  },
  {
    key: "fulfilment",
    label: "Fulfilment",
    items: [
      { key: "delivery-zones", label: "Delivery zones", href: AppRoute.DELIVERY_ZONES, icon: MapPinned, permission: AppPermission.DELIVERY_ZONE.READ, match: "prefix" },
      { key: "pickup-locations", label: "Pickup locations", href: AppRoute.PICKUP_LOCATIONS, icon: Store, permission: AppPermission.PICKUP_LOCATION.READ, match: "prefix" },
      { key: "operating-hours", label: "Opening hours", href: AppRoute.OPERATING_HOURS, icon: Clock, permission: AppPermission.OPERATING_HOURS.READ, match: "prefix" },
      { key: "fulfilment-settings", label: "Fulfilment settings", href: AppRoute.FULFILMENT_SETTINGS, icon: SlidersHorizontal, permission: AppPermission.FULFILMENT_SETTINGS.READ, match: "prefix" },
    ],
  },
  {
    key: "insights",
    label: "Insights",
    items: [
      { key: "reports", label: "Reports", href: AppRoute.REPORTS, icon: BarChart3, permission: CustomPermission.REPORT_READ, match: "prefix" },
      { key: "activity", label: "Activity", href: AppRoute.ACTIVITY, icon: History, permission: CustomPermission.ACTIVITY_READ, match: "prefix" },
    ],
  },
  {
    key: "team",
    label: "Team",
    items: [
      {
        key: "staff",
        label: "Staff",
        href: AppRoute.TEAM,
        icon: Users,
        permission: CustomPermission.STAFF_MANAGE,
        // Roles live under /team but are their own item.
        isActive: (pathname) => (pathname === AppRoute.TEAM || pathname.startsWith(`${AppRoute.TEAM}/`)) && !pathname.startsWith(AppRoute.ROLES),
      },
      { key: "roles", label: "Roles", href: AppRoute.ROLES, icon: ShieldCheck, permission: AppPermission.ROLE.READ, match: "prefix" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { key: "store-settings", label: "Store profile", href: AppRoute.STORE_SETTINGS, icon: Building2, permission: AppPermission.STORE_PROFILE.READ, match: "prefix" },
      { key: "theme-settings", label: "Theme", href: AppRoute.THEME_SETTINGS, icon: Palette, permission: AppPermission.STORE_PROFILE.READ, match: "prefix" },
      { key: "payment-settings", label: "Payment methods", href: AppRoute.PAYMENT_SETTINGS, icon: Landmark, permission: AppPermission.PAYMENT_SETTINGS.READ, match: "prefix" },
      { key: "inventory-settings", label: "Inventory settings", href: AppRoute.INVENTORY_SETTINGS, icon: PackageCheck, permission: AppPermission.INVENTORY_SETTINGS.READ, match: "prefix" },
      { key: "notification-settings", label: "Notifications", href: AppRoute.NOTIFICATION_SETTINGS, icon: Bell, permission: AppPermission.NOTIFICATION_SETTINGS.READ, match: "prefix" },
    ],
  },
];

/** The first screen this staff member may open — where "/" sends them. */
export function firstPermittedRoute(can: (permission: string) => boolean): string | null {
  for (const section of CONSOLE_NAV) {
    for (const item of section.items) {
      // "/" is where this answer is used, so it can never be the answer — that is a redirect loop.
      if (item.href === AppRoute.HOME) continue;
      if (!item.permission || can(item.permission)) return item.href;
    }
  }
  return null;
}
