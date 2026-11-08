import { describe, expect, it } from "vitest";
import { MAX_PRODUCT_SLUG_LENGTH, nextFreeSlug, slugFamilyPattern } from "./product-slug";

describe("nextFreeSlug", () => {
  it("keeps a free slug as it is", () => {
    expect(nextFreeSlug("golden-heart", [])).toBe("golden-heart");
    expect(nextFreeSlug("golden-heart", ["golden-heart-pendant"])).toBe("golden-heart");
  });

  it("suffixes -2 when the slug is taken", () => {
    expect(nextFreeSlug("golden-heart", ["golden-heart"])).toBe("golden-heart-2");
  });

  it("goes one past the highest suffix in use, never reusing a gap", () => {
    expect(nextFreeSlug("golden-heart", ["golden-heart", "golden-heart-2", "golden-heart-3"])).toBe("golden-heart-4");
    expect(nextFreeSlug("golden-heart", ["golden-heart", "golden-heart-5"])).toBe("golden-heart-6");
  });

  it("ignores slugs that merely start the same way", () => {
    expect(nextFreeSlug("ring", ["ring", "ring-gold", "ring-2b", "rings-9"])).toBe("ring-2");
  });

  it("treats regex characters in the base literally", () => {
    expect(nextFreeSlug("a.b", ["a.b", "axb-7"])).toBe("a.b-2");
  });

  it("still fits the maximum length once suffixed", () => {
    const long = `${"a".repeat(195)}-bbbb`;
    const free = nextFreeSlug(long, [long]);
    expect(free.length).toBeLessThanOrEqual(MAX_PRODUCT_SLUG_LENGTH);
    expect(free.endsWith("-2")).toBe(true);
    expect(free).not.toContain("--");
  });
});

describe("slugFamilyPattern", () => {
  it("matches the base and its numeric suffixes only", () => {
    const pattern = slugFamilyPattern("ring");
    expect(["ring", "ring-2", "ring-10"].every((slug) => pattern.test(slug))).toBe(true);
    expect(["ring-gold", "rings", "a-ring", "ring-2b"].some((slug) => pattern.test(slug))).toBe(false);
  });
});
