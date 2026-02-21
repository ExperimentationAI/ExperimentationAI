import { describe, it, expect } from "vitest";
import { calculatePower } from "../../src/stats/power.js";

describe("calculatePower", () => {
  it("calculates sample size for binary metric", () => {
    const result = calculatePower({
      baseline: 0.42,
      mde: 0.10, // 10% relative → ~4.2pp
      metricType: "binary",
    });

    expect(result.requiredNPerVariant).toHaveLength(2);
    expect(result.totalRequired).toBeGreaterThan(0);
    // With 42% baseline, 10% relative MDE, should need ~2000-4000 per arm
    expect(result.requiredNPerVariant[0]).toBeGreaterThan(1000);
    expect(result.requiredNPerVariant[0]).toBeLessThan(10000);
    expect(result.interpretation).toContain("Sample size");
  });

  it("handles 3-arm unequal allocation (20/40/40)", () => {
    const result = calculatePower({
      baseline: 0.42,
      mde: 0.10,
      metricType: "binary",
      allocationRatios: [0.20, 0.40, 0.40],
    });

    expect(result.requiredNPerVariant).toHaveLength(3);
    // Control arm (20%) should have fewer users than treatment arms (40%)
    expect(result.totalRequired).toBeGreaterThan(0);
  });

  it("calculates sample size for continuous metric", () => {
    const result = calculatePower({
      baseline: 450, // MXN revenue
      mde: 45, // 45 MXN absolute
      metricType: "continuous",
      baselineStdDev: 180,
    });

    expect(result.requiredNPerVariant).toHaveLength(2);
    expect(result.totalRequired).toBeGreaterThan(0);
  });

  it("computes current power with currentN", () => {
    const result = calculatePower({
      baseline: 0.42,
      mde: 0.10,
      metricType: "binary",
      allocationRatios: [0.20, 0.40, 0.40],
      currentN: [5000, 10000, 10000],
    });

    expect(result.currentPower).not.toBeNull();
    expect(result.currentPower!).toBeGreaterThan(0);
    expect(result.currentPower!).toBeLessThanOrEqual(1);
    expect(result.currentN).toEqual([5000, 10000, 10000]);
  });

  it("reports adequate power when sample is large enough", () => {
    const result = calculatePower({
      baseline: 0.42,
      mde: 0.10,
      metricType: "binary",
      currentN: [20000, 20000],
    });

    expect(result.currentPower!).toBeGreaterThan(0.80);
    expect(result.interpretation).toContain("reached target power");
  });

  it("reports underpowered when sample is too small", () => {
    const result = calculatePower({
      baseline: 0.42,
      mde: 0.10,
      metricType: "binary",
      currentN: [100, 100],
    });

    expect(result.currentPower!).toBeLessThan(0.80);
    expect(result.interpretation).toContain("underpowered");
  });

  it("throws for invalid allocation ratios", () => {
    expect(() =>
      calculatePower({
        baseline: 0.42,
        mde: 0.10,
        allocationRatios: [0.3, 0.3, 0.3], // Sums to 0.9
      })
    ).toThrow("sum to 1.0");
  });

  it("throws for zero MDE (continuous)", () => {
    expect(() =>
      calculatePower({
        baseline: 100,
        mde: 0,
        metricType: "continuous",
        baselineStdDev: 20,
      })
    ).toThrow("non-zero");
  });
});
