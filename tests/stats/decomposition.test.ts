import { describe, it, expect } from "vitest";
import { decomposeMetric } from "../../src/stats/decomposition.js";

describe("decomposeMetric", () => {
  it("decomposes a pure rate effect correctly", () => {
    // Same mix, different rates → all rate effect
    const result = decomposeMetric({
      segments: [
        { name: "High Value", controlCount: 500, controlRate: 0.40, treatmentCount: 500, treatmentRate: 0.50 },
        { name: "Low Value", controlCount: 500, controlRate: 0.20, treatmentCount: 500, treatmentRate: 0.25 },
      ],
    });

    // Rate effect should dominate
    expect(result.rateEffect).not.toBe(0);
    expect(Math.abs(result.mixEffect)).toBeLessThan(0.001);
    expect(result.interpretation).toContain("RATE");
  });

  it("decomposes a pure mix effect correctly", () => {
    // Same rates, different mix → all mix effect
    const result = decomposeMetric({
      segments: [
        { name: "High Value", controlCount: 500, controlRate: 0.60, treatmentCount: 800, treatmentRate: 0.60 },
        { name: "Low Value", controlCount: 500, controlRate: 0.20, treatmentCount: 200, treatmentRate: 0.20 },
      ],
    });

    // Mix effect should dominate (more high-value users in treatment)
    expect(Math.abs(result.rateEffect)).toBeLessThan(0.001);
    expect(result.mixEffect).not.toBe(0);
    expect(result.interpretation).toContain("MIX");
  });

  it("decomposes both effects", () => {
    const result = decomposeMetric({
      segments: [
        { name: "Segment A", controlCount: 600, controlRate: 0.30, treatmentCount: 800, treatmentRate: 0.35 },
        { name: "Segment B", controlCount: 400, controlRate: 0.10, treatmentCount: 200, treatmentRate: 0.15 },
      ],
    });

    // Both effects should be present
    expect(result.rateEffect).not.toBe(0);
    expect(result.mixEffect).not.toBe(0);
    // Total should equal sum
    expect(result.totalChange).toBeCloseTo(result.rateEffect + result.mixEffect, 8);
  });

  it("validates additivity (rate + mix = total)", () => {
    const result = decomposeMetric({
      segments: [
        { name: "New Users", controlCount: 300, controlRate: 0.10, treatmentCount: 500, treatmentRate: 0.12 },
        { name: "Returning", controlCount: 700, controlRate: 0.50, treatmentCount: 500, treatmentRate: 0.55 },
      ],
    });

    expect(Math.abs(result.totalChange - result.rateEffect - result.mixEffect)).toBeLessThan(1e-8);
  });

  it("includes per-segment contributions", () => {
    const result = decomposeMetric({
      segments: [
        { name: "A", controlCount: 500, controlRate: 0.40, treatmentCount: 500, treatmentRate: 0.50 },
        { name: "B", controlCount: 500, controlRate: 0.20, treatmentCount: 500, treatmentRate: 0.25 },
      ],
    });

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].name).toBe("A");
    expect(result.segments[0].controlWeight).toBeCloseTo(0.5, 4);
    expect(result.segments[0].treatmentWeight).toBeCloseTo(0.5, 4);
  });

  it("handles single segment", () => {
    const result = decomposeMetric({
      segments: [
        { name: "All", controlCount: 1000, controlRate: 0.30, treatmentCount: 1000, treatmentRate: 0.35 },
      ],
    });

    // With one segment, mix effect should be 0 (no mix to shift)
    expect(Math.abs(result.mixEffect)).toBeLessThan(0.001);
    expect(result.totalChange).toBeCloseTo(0.05, 4);
  });

  it("throws for empty segments", () => {
    expect(() =>
      decomposeMetric({ segments: [] })
    ).toThrow("At least one segment");
  });

  it("throws for zero total counts", () => {
    expect(() =>
      decomposeMetric({
        segments: [
          { name: "A", controlCount: 0, controlRate: 0.5, treatmentCount: 100, treatmentRate: 0.6 },
        ],
      })
    ).toThrow("non-zero total counts");
  });

  it("produces meaningful interpretation", () => {
    const result = decomposeMetric({
      segments: [
        { name: "High", controlCount: 500, controlRate: 0.50, treatmentCount: 700, treatmentRate: 0.55 },
        { name: "Low", controlCount: 500, controlRate: 0.10, treatmentCount: 300, treatmentRate: 0.12 },
      ],
    });

    expect(result.interpretation).toContain("Total metric change");
    expect(result.interpretation).toContain("rate effect");
    expect(result.interpretation).toContain("mix effect");
  });
});
