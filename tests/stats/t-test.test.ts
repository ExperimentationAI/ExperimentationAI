import { describe, it, expect } from "vitest";
import { twoSampleTTest } from "../../src/stats/t-test.js";

describe("twoSampleTTest (Welch's)", () => {
  it("detects a significant difference between groups", () => {
    // Reference: scipy.stats.ttest_ind([...], [...], equal_var=False)
    // Control: mean=100, std=15, n=50
    // Treatment: mean=110, std=15, n=50
    const result = twoSampleTTest({
      control: { mean: 100, stdDev: 15, n: 50 },
      treatment: { mean: 110, stdDev: 15, n: 50 },
    });

    expect(result.testName).toBe("Welch's Two-Sample t-Test");
    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    // t-stat ≈ 3.333
    expect(result.testStatistic).toBeCloseTo(3.333, 1);
    expect(result.effectSize).toBeCloseTo(10, 2);
    expect(result.relativeEffectSize).toBeCloseTo(0.1, 2);
    expect(result.confidenceInterval.lower).toBeGreaterThan(0);
    expect(result.confidenceInterval.upper).toBeGreaterThan(result.confidenceInterval.lower);
  });

  it("does not detect significance when means are close", () => {
    const result = twoSampleTTest({
      control: { mean: 100, stdDev: 15, n: 30 },
      treatment: { mean: 101, stdDev: 15, n: 30 },
    });

    expect(result.significant).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("handles equal means", () => {
    const result = twoSampleTTest({
      control: { mean: 50, stdDev: 10, n: 100 },
      treatment: { mean: 50, stdDev: 10, n: 100 },
    });

    expect(result.testStatistic).toBe(0);
    expect(result.pValue).toBe(1);
    expect(result.significant).toBe(false);
    expect(result.effectSize).toBe(0);
  });

  it("handles zero standard deviations", () => {
    const result = twoSampleTTest({
      control: { mean: 50, stdDev: 0, n: 100 },
      treatment: { mean: 50, stdDev: 0, n: 100 },
    });

    expect(result.pValue).toBe(1);
    expect(result.significant).toBe(false);
  });

  it("handles unequal sample sizes", () => {
    const result = twoSampleTTest({
      control: { mean: 100, stdDev: 20, n: 200 },
      treatment: { mean: 108, stdDev: 18, n: 50 },
    });

    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    // Welch-Satterthwaite df should be less than n1+n2-2
    expect(result.effectSize).toBeCloseTo(8, 2);
  });

  it("respects custom alpha", () => {
    // A result that's significant at 0.05 but not at 0.01
    const result005 = twoSampleTTest({
      control: { mean: 100, stdDev: 30, n: 50 },
      treatment: { mean: 110, stdDev: 30, n: 50 },
      alpha: 0.05,
    });

    const result001 = twoSampleTTest({
      control: { mean: 100, stdDev: 30, n: 50 },
      treatment: { mean: 110, stdDev: 30, n: 50 },
      alpha: 0.01,
    });

    expect(result005.alpha).toBe(0.05);
    expect(result001.alpha).toBe(0.01);
    // Same p-value, different significance conclusions possible
    expect(result005.pValue).toBeCloseTo(result001.pValue, 10);
  });

  it("handles one-sided alternative (greater)", () => {
    const result = twoSampleTTest({
      control: { mean: 100, stdDev: 15, n: 50 },
      treatment: { mean: 110, stdDev: 15, n: 50 },
      alternative: "greater",
    });

    expect(result.significant).toBe(true);
    // One-sided p should be half of two-sided
    const twoSided = twoSampleTTest({
      control: { mean: 100, stdDev: 15, n: 50 },
      treatment: { mean: 110, stdDev: 15, n: 50 },
      alternative: "two-sided",
    });
    expect(result.pValue).toBeCloseTo(twoSided.pValue / 2, 6);
  });

  it("handles one-sided alternative (less)", () => {
    const result = twoSampleTTest({
      control: { mean: 110, stdDev: 15, n: 50 },
      treatment: { mean: 100, stdDev: 15, n: 50 },
      alternative: "less",
    });

    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("throws for n < 2", () => {
    expect(() =>
      twoSampleTTest({
        control: { mean: 50, stdDev: 10, n: 1 },
        treatment: { mean: 60, stdDev: 10, n: 50 },
      })
    ).toThrow("at least 2");
  });

  it("matches hand-calculated reference values", () => {
    // Welch's t-test by hand:
    // treatment: mean=5.5, std=1.2, n=30 → SE1 = 1.44/30 = 0.048
    // control: mean=5.0, std=1.5, n=35 → SE2 = 2.25/35 = 0.06429
    // SE = sqrt(0.048 + 0.06429) = sqrt(0.11229) = 0.33509
    // t = (5.5 - 5.0) / 0.33509 = 1.4921
    // df = (0.048 + 0.06429)^2 / ((0.048^2/29) + (0.06429^2/34))
    //    = 0.01261 / (0.0000794 + 0.0001215) = 0.01261 / 0.0002010 = 62.75
    const result = twoSampleTTest({
      control: { mean: 5.0, stdDev: 1.5, n: 35 },
      treatment: { mean: 5.5, stdDev: 1.2, n: 30 },
    });

    expect(result.testStatistic).toBeCloseTo(1.4921, 2);
    expect(result.pValue).toBeGreaterThan(0.05);
    expect(result.pValue).toBeLessThan(0.20);
    expect(result.significant).toBe(false);
    expect(result.effectSize).toBeCloseTo(0.5, 4);
  });
});
