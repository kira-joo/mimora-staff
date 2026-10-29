import { describe, expect, it } from "vitest";
import { AppPermission, CustomPermission } from "../../../common/authorization/authorization-registry";
import { EMAILING_EVENT_TYPES, ORDER_EMAIL_EVENT_LABELS, isEmailEnabledFor, orderEmailKindForEvent } from "./order-email-policy";
import { STAFF_NOTIFICATION_TYPES, crossedLowStockThreshold, notificationTypesVisibleTo, staffNotificationTypeForEvent } from "./staff-notification-policy";

describe("order email mapping", () => {
  it.each([
    ["ORDER_PLACED", "order-placed"],
    ["ORDER_CONFIRMED", "order-confirmed"],
    ["PAYMENT_VERIFIED", "payment-verified"],
    ["PAYMENT_REJECTED", "payment-rejected"],
    ["ORDER_SHIPPED", "order-shipped"],
    ["ORDER_READY_FOR_PICKUP", "order-ready-for-pickup"],
    ["ORDER_COLLECTED", "order-collected"],
    ["ORDER_DELIVERED", "order-delivered"],
    ["ORDER_CANCELLED", "order-cancelled"],
    ["PAYMENT_REFUNDED", "refund-recorded"],
    ["REFUND_ISSUED", "refund-recorded"],
  ])("%s sends %s", (event, kind) => {
    expect(orderEmailKindForEvent(event)).toBe(kind);
  });

  it.each(["ORDER_PROCESSING", "ORDER_IN_TRANSIT", "ORDER_TRACKING_UPDATED", "PAYMENT_SUBMITTED", "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_REJECTED", "RETURN_RECEIVED", "SOMETHING_NEW", "constructor", "__proto__", ""])(
    "%s sends nothing — an unknown or unlisted event is 'no email'",
    (event) => {
      expect(orderEmailKindForEvent(event)).toBeNull();
    }
  );

  it("lists exactly the eleven emailing events", () => {
    expect(EMAILING_EVENT_TYPES).toHaveLength(11);
  });

  it("labels exactly the emailing events — the settings screen offers these and nothing else", () => {
    expect(Object.keys(ORDER_EMAIL_EVENT_LABELS)).toEqual([...EMAILING_EVENT_TYPES]);
    for (const label of Object.values(ORDER_EMAIL_EVENT_LABELS)) expect(label.trim().length).toBeGreaterThan(0);
  });
});

describe("isEmailEnabledFor", () => {
  const rules = [
    { event: "ORDER_SHIPPED", channels: ["EMAIL"] },
    { event: "ORDER_DELIVERED", channels: ["SMS"] },
    { event: "ORDER_CANCELLED", channels: ["SMS", "EMAIL"] },
  ];
  it("needs a rule for the event with EMAIL ticked", () => {
    expect(isEmailEnabledFor(rules, "ORDER_SHIPPED")).toBe(true);
    expect(isEmailEnabledFor(rules, "ORDER_CANCELLED")).toBe(true);
    expect(isEmailEnabledFor(rules, "ORDER_DELIVERED")).toBe(false); // SMS only
    expect(isEmailEnabledFor(rules, "ORDER_CONFIRMED")).toBe(false); // no rule
  });
  it("is off by default: no settings, an empty list", () => {
    expect(isEmailEnabledFor(undefined, "ORDER_SHIPPED")).toBe(false);
    expect(isEmailEnabledFor(null, "ORDER_SHIPPED")).toBe(false);
    expect(isEmailEnabledFor([], "ORDER_SHIPPED")).toBe(false);
  });
});

describe("staff notification policy", () => {
  it("each kind needs the permission on the record it announces", () => {
    expect(notificationTypesVisibleTo(() => false)).toEqual([]);
    expect(notificationTypesVisibleTo(() => true)).toEqual([...STAFF_NOTIFICATION_TYPES]);
    expect(notificationTypesVisibleTo((p) => p === AppPermission.ORDER.READ)).toEqual(["NEW_ORDER"]);
    expect(notificationTypesVisibleTo((p) => p === CustomPermission.PAYMENT_VERIFY)).toEqual(["PAYMENT_PROOF_SUBMITTED"]);
    expect(notificationTypesVisibleTo((p) => p === AppPermission.RETURN.READ)).toEqual(["RETURN_REQUESTED"]);
    expect(notificationTypesVisibleTo((p) => p === AppPermission.VARIANT.READ)).toEqual(["LOW_STOCK"]);
  });

  it("maps the three timeline events that raise a notice, and nothing else", () => {
    expect(staffNotificationTypeForEvent("ORDER_PLACED")).toBe("NEW_ORDER");
    expect(staffNotificationTypeForEvent("PAYMENT_SUBMITTED")).toBe("PAYMENT_PROOF_SUBMITTED");
    expect(staffNotificationTypeForEvent("RETURN_REQUESTED")).toBe("RETURN_REQUESTED");
    for (const other of ["ORDER_CONFIRMED", "ORDER_SHIPPED", "PAYMENT_VERIFIED", "RETURN_APPROVED", "X"]) expect(staffNotificationTypeForEvent(other)).toBeNull();
  });

  describe("crossedLowStockThreshold", () => {
    it("is true only when stock falls from healthy to at-or-below the threshold", () => {
      expect(crossedLowStockThreshold(6, 5, 5)).toBe(true); // lands exactly on it
      expect(crossedLowStockThreshold(10, 2, 5)).toBe(true);
      expect(crossedLowStockThreshold(10, 0, 5)).toBe(true); // straight to empty
      expect(crossedLowStockThreshold(6, 6, 5)).toBe(false); // no change
      expect(crossedLowStockThreshold(7, 6, 5)).toBe(false); // still healthy
      expect(crossedLowStockThreshold(5, 4, 5)).toBe(false); // already low
      expect(crossedLowStockThreshold(2, 0, 5)).toBe(false); // already low, now empty
      expect(crossedLowStockThreshold(3, 8, 5)).toBe(false); // restock
    });
    it("a zero threshold still fires when stock reaches zero", () => {
      expect(crossedLowStockThreshold(1, 0, 0)).toBe(true);
      expect(crossedLowStockThreshold(2, 1, 0)).toBe(false);
    });
  });
});
