import { describe, expect, it } from "vitest";
import { TIMELINE_LABEL, timelineActorLabel, timelineEventLabel } from "./timeline-labels";

describe("timelineEventLabel", () => {
  it("labels PAYMENT_SUBMITTED — the event the server actually writes — not a humanised fallback", () => {
    expect(TIMELINE_LABEL.PAYMENT_SUBMITTED).toBe("Payment proof submitted");
    expect(timelineEventLabel("PAYMENT_SUBMITTED")).toBe("Payment proof submitted");
  });

  it("falls back to a readable form for an event it has no label for", () => {
    expect(timelineEventLabel("SOMETHING_NEW_HAPPENED")).toBe("Something new happened");
  });
});

describe("timelineActorLabel", () => {
  it("names the staff member who acted", () => {
    expect(timelineActorLabel({ actorType: "STAFF", actorName: "Mona Adel" })).toBe("Mona Adel");
  });

  it("says so when the staff account is gone, rather than a bare 'Staff'", () => {
    expect(timelineActorLabel({ actorType: "STAFF" })).toBe("Staff (account removed)");
  });

  it("reads customer and system actors plainly", () => {
    expect(timelineActorLabel({ actorType: "CUSTOMER" })).toBe("Customer");
    expect(timelineActorLabel({ actorType: "SYSTEM" })).toBe("System");
  });
});
