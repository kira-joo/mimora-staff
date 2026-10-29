import { describe, expect, it } from "vitest";
import { EMAILING_EVENT_TYPES } from "src/server/engines/notifications/order-email-policy";
import { notificationEventOptions } from "./notification-events";

describe("notificationEventOptions", () => {
  it("offers every supported event, labelled, for a new rule", () => {
    const options = notificationEventOptions("", []);
    expect(options.map((o) => o.value)).toEqual([...EMAILING_EVENT_TYPES]);
    expect(options.find((o) => o.value === "ORDER_COLLECTED")?.label).toBe("Collected (pickup)");
    expect(options.every((o) => o.label.trim().length > 0)).toBe(true);
  });

  it("hides events another rule already uses, but keeps the row's own", () => {
    const options = notificationEventOptions("ORDER_SHIPPED", ["ORDER_PLACED", "ORDER_SHIPPED", "ORDER_DELIVERED"]);
    const values = options.map((o) => o.value);
    expect(values).toContain("ORDER_SHIPPED");
    expect(values).not.toContain("ORDER_PLACED");
    expect(values).not.toContain("ORDER_DELIVERED");
  });

  it("keeps an unsupported saved key visible and says it sends nothing, rather than rewriting it", () => {
    const options = notificationEventOptions("ORDER_IN_TRANSIT", []);
    expect(options.at(-1)).toEqual({ value: "ORDER_IN_TRANSIT", label: "ORDER_IN_TRANSIT (not supported — sends nothing)" });
  });
});
