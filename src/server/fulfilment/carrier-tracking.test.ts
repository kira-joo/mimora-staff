import { ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { describe, expect, it } from "vitest";
import { buildTrackingSnapshot, carrierListProblems, resolveTrackingUrl, validateTrackingNumber, validateUrlTemplate, type Carrier } from "./carrier-tracking";

const ARAMEX: Carrier = { key: "aramex", name: "Aramex", urlTemplate: "https://www.aramex.com/track/results?ShipmentNumber={tracking}" };

describe("validateUrlTemplate", () => {
  it("accepts an https template with {tracking} in the path or the query", () => {
    expect(validateUrlTemplate("https://carrier.example/track/{tracking}")).toBeUndefined();
    expect(validateUrlTemplate(ARAMEX.urlTemplate)).toBeUndefined();
    expect(validateUrlTemplate("https://carrier.example/t?a=1&n={tracking}#top")).toBeUndefined();
  });

  it.each([
    ["http (not https)", "http://carrier.example/track/{tracking}", /https/],
    ["javascript:", "javascript:alert({tracking})", /https/],
    ["data:", "data:text/html,{tracking}", /https/],
    ["protocol-relative", "//carrier.example/track/{tracking}", /https/],
    ["no placeholder", "https://carrier.example/track", /\{tracking\}/],
    ["a different placeholder", "https://carrier.example/track/{tracking}/{other}", /braces/],
    ["a stray brace", "https://carrier.example/track/{tracking}}", /braces/],
    ["whitespace", "https://carrier.example/track me/{tracking}", /spaces/],
    ["the number inside the host", "https://{tracking}.carrier.example/", /after the host/],
    ["the number as the whole authority", "https://{tracking}", /after the host/],
    ["credentials", "https://user:pass@carrier.example/{tracking}", /credentials/],
    ["empty", "", /required/],
  ])("refuses %s", (_label, template, message) => {
    expect(validateUrlTemplate(template)).toMatch(message);
  });

  it("refuses an over-long template", () => {
    expect(validateUrlTemplate(`https://carrier.example/${"a".repeat(600)}/{tracking}`)).toMatch(/at most/);
  });
});

describe("validateTrackingNumber", () => {
  it("accepts the codes couriers print", () => {
    for (const value of ["1Z999AA10123456784", "EG123456789EG", "AB-123/456_7.8", "  74839201  "]) expect(validateTrackingNumber(value)).toBeUndefined();
  });

  it.each(["", "   ", "-leading-dash", "a<script>", "a?b=c", "x".repeat(65)])("refuses %j", (value) => {
    expect(validateTrackingNumber(value)).toBeDefined();
  });
});

describe("resolveTrackingUrl", () => {
  it("puts the number into every placeholder, trimmed and percent-encoded", () => {
    expect(resolveTrackingUrl(ARAMEX.urlTemplate, " 123 456/7 ")).toBe("https://www.aramex.com/track/results?ShipmentNumber=123%20456%2F7");
    expect(resolveTrackingUrl("https://c.example/{tracking}?ref={tracking}", "AB1")).toBe("https://c.example/AB1?ref=AB1");
  });
});

describe("carrierListProblems", () => {
  it("is empty for a good list, including an empty one", () => {
    expect(carrierListProblems([ARAMEX, { key: "bosta", name: "Bosta", urlTemplate: "https://bosta.co/tracking/{tracking}" }])).toEqual([]);
    expect(carrierListProblems([])).toEqual([]);
  });

  it("reports each problem against the field the form can show it on", () => {
    const problems = carrierListProblems([
      { key: "Bad Key", name: "  ", urlTemplate: "http://x.example/{tracking}" },
      { key: "ok", name: "Ok", urlTemplate: "https://ok.example/{tracking}" },
      { key: "ok", name: "Ok again", urlTemplate: "https://ok.example/{tracking}" },
    ]);
    expect(problems.map((problem) => problem.field).sort()).toEqual(["carriers.0.key", "carriers.0.name", "carriers.0.urlTemplate", "carriers.2.key"]);
    expect(problems.find((problem) => problem.field === "carriers.2.key")!.messages[0]).toMatch(/used twice/);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ key: `c${index}`, name: `C${index}`, urlTemplate: "https://c.example/{tracking}" }));
    expect(carrierListProblems(many).some((problem) => problem.field === "carriers")).toBe(true);
  });
});

describe("buildTrackingSnapshot", () => {
  it("is undefined when staff entered neither — tracking is optional", () => {
    expect(buildTrackingSnapshot({}, [ARAMEX])).toBeUndefined();
    expect(buildTrackingSnapshot({ carrierKey: "  ", trackingNumber: "" }, [ARAMEX])).toBeUndefined();
  });

  it("snapshots the carrier's name and the resolved link", () => {
    expect(buildTrackingSnapshot({ carrierKey: "aramex", trackingNumber: " 123456 " }, [ARAMEX])).toEqual({
      carrierKey: "aramex",
      carrierName: "Aramex",
      trackingNumber: "123456",
      url: "https://www.aramex.com/track/results?ShipmentNumber=123456",
    });
  });

  it("validates carrier and number TOGETHER: either one alone is refused, naming the missing field", () => {
    expect(() => buildTrackingSnapshot({ carrierKey: "aramex" }, [ARAMEX])).toThrow(ValidationFailedError);
    try {
      buildTrackingSnapshot({ trackingNumber: "123" }, [ARAMEX]);
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationFailedError).validationErrors.map((problem) => problem.field)).toEqual(["carrierKey"]);
    }
    try {
      buildTrackingSnapshot({ carrierKey: "aramex" }, [ARAMEX]);
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationFailedError).validationErrors.map((problem) => problem.field)).toEqual(["trackingNumber"]);
    }
  });

  it("refuses a carrier the store has not configured, and a malformed number", () => {
    const problems = (input: { carrierKey: string; trackingNumber: string }) => {
      try {
        buildTrackingSnapshot(input, [ARAMEX]);
      } catch (error) {
        return (error as ValidationFailedError).validationErrors;
      }
      return [];
    };
    expect(problems({ carrierKey: "dhl", trackingNumber: "123" })).toEqual([{ field: "carrierKey", messages: ["This carrier is not configured."] }]);
    expect(problems({ carrierKey: "aramex", trackingNumber: "a<b" }).map((problem) => problem.field)).toEqual(["trackingNumber"]);
  });
});
