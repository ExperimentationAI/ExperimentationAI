import { describe, it, expect } from "vitest";
import { twoProportionZTest } from "../../src/stats/z-test.js";

describe("twoProportionZTest", () => {
  it("detects a significant difference in proportions", () => {
    // Control: 200/1000 = 20%, Treatment: 250/1000 = 25%
    const result = twoProportionZTest({
      control: { successes: 200, n: 1000 },
      treatment: { successes: 250, n: 1000 },
    });

    expect(result.testName).toBe("Two-Proportion z-Test");
    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.effectSize).toBeCloseTo(0.05, 3);
    expect(result.relativeEffectSize).toBeCloseTo(0.25, 2);
    expect(result.confidenceInterval.lower).toBeGreaterThan(0);
  });

  it("does not detect significance for small differences", () => {
    // Control: 100/1000 = 10%, Treatment: 105/1000 = 10.5%
    const result = twoProportionZTest({
      control: { successes: 100, n: 1000 },
      treatment: { successes: 105, n: 1000 },
    });

    expect(result.significant).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("handles equal proportions", () => {
    const result = twoProportionZTest({
      control: { successes: 50, n: 500 },
      treatment: { successes: 50, n: 500 },
    });

    expect(result.testStatistic).toBe(0);
    expect(result.pValue).toBeCloseTo(1, 6);
    expect(result.significant).toBe(false);
  });

  it("handles 0% and 0% (zero variance)", () => {
    const result = twoProportionZTest({
      control: { successes: 0, n: 100 },
      treatment: { successes: 0, n: 100 },
    });

    expect(result.pValue).toBe(1);
    expect(result.significant).toBe(false);
  });

  it("handles 100% and 100% (zero variance)", () => {
    const result = twoProportionZTest({
      control: { successes: 100, n: 100 },
      treatment: { successes: 100, n: 100 },
    });

    expect(result.pValue).toBe(1);
    expect(result.significant).toBe(false);
  });

  it("handles unequal sample sizes", () => {
    const result = twoProportionZTest({
      control: { successes: 300, n: 2000 },
      treatment: { successes: 80, n: 400 },
    });

    // Control: 15%, Treatment: 20%
    expect(result.significant).toBe(true);
    expect(result.effectSize).toBeCloseTo(0.05, 3);
  });

  it("respects custom alpha", () => {
    const result = twoProportionZTest({
      control: { successes: 100, n: 500 },
      treatment: { successes: 120, n: 500 },
      alpha: 0.01,
    });

    expect(result.alpha).toBe(0.01);
  });

  it("handles one-sided alternative (greater)", () => {
    const result = twoProportionZTest({
      control: { successes: 200, n: 1000 },
      treatment: { successes: 250, n: 1000 },
      alternative: "greater",
    });

    const twoSided = twoProportionZTest({
      control: { successes: 200, n: 1000 },
      treatment: { successes: 250, n: 1000 },
      alternative: "two-sided",
    });

    expect(result.pValue).toBeCloseTo(twoSided.pValue / 2, 6);
    expect(result.significant).toBe(true);
  });

  it("handles one-sided alternative (less)", () => {
    const result = twoProportionZTest({
      control: { successes: 250, n: 1000 },
      treatment: { successes: 200, n: 1000 },
      alternative: "less",
    });

    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("throws for n < 1", () => {
    expect(() =>
      twoProportionZTest({
        control: { successes: 0, n: 0 },
        treatment: { successes: 5, n: 100 },
      })
    ).toThrow("at least 1");
  });

  it("matches reference values for known data", () => {
    // Pooled two-proportion z-test:
    // p1 = 120/500 = 0.24, p2 = 100/500 = 0.20
    // p_pool = 220/1000 = 0.22
    // SE = sqrt(0.22 * 0.78 * (1/500 + 1/500)) = sqrt(0.22 * 0.78 * 0.004)
    //    = sqrt(0.0006864) = 0.026199
    // z = (0.24 - 0.20) / 0.026199 = 1.5268
    // p = 2 * (1 - Φ(1.5268)) ≈ 0.1269
    const result = twoProportionZTest({
      control: { successes: 100, n: 500 },
      treatment: { successes: 120, n: 500 },
    });

    expect(result.testStatistic).toBeCloseTo(1.5268, 2);
    expect(result.pValue).toBeCloseTo(0.1269, 2);
    expect(result.significant).toBe(false);
  });

  it("produces correct confidence interval bounds", () => {
    const result = twoProportionZTest({
      control: { successes: 200, n: 1000 },
      treatment: { successes: 250, n: 1000 },
    });

    // CI should contain the point estimate
    expect(result.effectSize).toBeGreaterThanOrEqual(result.confidenceInterval.lower);
    expect(result.effectSize).toBeLessThanOrEqual(result.confidenceInterval.upper);
    expect(result.confidenceInterval.level).toBe(0.95);
  });
});
