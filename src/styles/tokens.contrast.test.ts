import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The contrast gate (docs/design-system.md §8): every ratio is recomputed
 * from tokens.css itself, so a value edited below threshold fails here rather
 * than shipping on the strength of a comment.
 */
const css = readFileSync(join(__dirname, "tokens.css"), "utf8");

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css);
  if (!match) throw new Error(`--${name} is not a literal hex in tokens.css`);
  return match[1]!;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;
const GROUNDS = ["st-canvas", "st-surface"];

const textOnGrounds = [
  "st-ink",
  "st-ink-muted",
  "st-accent",
  "st-status-neutral",
  "st-status-confirmed",
  "st-status-processing",
  "st-status-ready",
  "st-status-transit",
  "st-status-done",
  "st-status-pending",
  "st-status-refunded",
  "st-status-danger",
  "ftk-text-placeholder",
];
const boundariesOnGrounds = ["st-line-strong", "st-focus"];

describe("tokens.css contrast gate", () => {
  it.each(textOnGrounds.flatMap((fg) => GROUNDS.map((bg) => [fg, bg])))("text %s on %s ≥ 4.5:1", (fg, bg) => {
    expect(contrast(token(fg!), token(bg!))).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(boundariesOnGrounds.flatMap((fg) => GROUNDS.map((bg) => [fg, bg])))("boundary %s on %s ≥ 3:1 (WCAG 1.4.11)", (fg, bg) => {
    expect(contrast(token(fg!), token(bg!))).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it("danger text on its alert ground ≥ 4.5:1", () => {
    expect(contrast(token("st-status-danger"), token("st-status-danger-soft"))).toBeGreaterThanOrEqual(TEXT);
  });

  it("white on the primary action ≥ 4.5:1", () => {
    expect(contrast(token("ftk-text-on-primary"), token("st-accent"))).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(token("ftk-text-on-primary"), token("st-accent-hover"))).toBeGreaterThanOrEqual(TEXT);
  });

  it("the decorative line is deliberately below 3:1 — it must never draw a control", () => {
    expect(contrast(token("st-line"), token("st-surface"))).toBeLessThan(NON_TEXT);
  });

  it("the gate can fail: a below-threshold pair is caught", () => {
    expect(contrast("#7e8892", "#ffffff")).toBeLessThan(TEXT);
  });
});
