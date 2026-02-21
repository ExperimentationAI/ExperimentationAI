import { describe, it, expect } from "vitest";
import { nonInferiorityTest } from "../../src/stats/non-inferiority.js";

describe("nonInferiorityTest", () => {
  it("establishes non-inferiority when treatment is similar to control", () => {
    // Treatment is slightly worse but within 10% margin
    const result = nonInferiorityTest({
      control: { mean: 100, stdDev: 25, n: 1000 },
      treatment: { mean: 97, stdDev: 25, n: 1000 },
      margin: 0.10, // 10% relative → δ = 10
    });

    expect(result.nonInferior).toBe(true);
    expect(result.pValue).toBeLessThan(0.10);
    expect(result.observedDiff).toBeCloseTo(-3, 2);
    expect(result.absoluteMargin).toBeCloseTo(10, 2);
    expect(result.interpretation).toContain("ESTABLISHED");
  });

  it("fails non-inferiority when treatment is much worse", () => {
    // Treatment is 20% worse, margin is 10%
    const result = nonInferiorityTest({
      control: { mean: 100, stdDev: 15, n: 500 },
      treatment: { mean: 80, stdDev: 15, n: 500 },
      margin: 0.10,
    });

    expect(result.nonInferior).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.10);
    expect(result.interpretation).toContain("NOT established");
  });

  it("passes when treatment is better than control", () => {
    const result = nonInferiorityTest({
      control: { mean: 100, stdDev: 20, n: 500 },
      treatment: { mean: 110, stdDev: 20, n: 500 },
      margin: 0.10,
    });

    expect(result.nonInferior).toBe(true);
    expect(result.pValue).toBeLessThan(0.01); // Very clear non-inferiority
    expect(result.observedDiff).toBeCloseTo(10, 2);
  });

  it("handles binary metrics (proportions)", () => {
    // Control: 42%, Treatment: 40% — within 10% relative margin
    const result = nonInferiorityTest({
      control: { mean: 0.42, stdDev: 0, n: 2000 },
      treatment: { mean: 0.40, stdDev: 0, n: 2000 },
      margin: 0.10,
      metricType: "binary",
    });

    expect(result.nonInferior).toBe(true);
    expect(result.absoluteMargin).toBeCloseTo(0.042, 3);
  });

  it("uses absolute margin when specified", () => {
    const result = nonInferiorityTest({
      control: { mean: 100, stdDev: 20, n: 1000 },
      treatment: { mean: 95, stdDev: 20, n: 1000 },
      margin: 8,
      marginType: "absolute",
    });

    expect(result.nonInferior).toBe(true);
    expect(result.absoluteMargin).toBe(8);
  });

  it("respects alpha level", () => {
    // Borderline case — passes at α=0.10 but may not at α=0.05
    const result010 = nonInferiorityTest({
      control: { mean: 100, stdDev: 30, n: 200 },
      treatment: { mean: 93, stdDev: 30, n: 200 },
      margin: 0.10,
      alpha: 0.10,
    });

    const result005 = nonInferiorityTest({
      control: { mean: 100, stdDev: 30, n: 200 },
      treatment: { mean: 93, stdDev: 30, n: 200 },
      margin: 0.10,
      alpha: 0.05,
    });

    // Both should have the same p-value
    expect(result010.pValue).toBeCloseTo(result005.pValue, 6);
  });

  it("throws for n < 2", () => {
    expect(() =>
      nonInferiorityTest({
        control: { mean: 100, stdDev: 10, n: 1 },
        treatment: { mean: 95, stdDev: 10, n: 500 },
        margin: 0.10,
      })
    ).toThrow("at least 2");
  });

  it("handles zero variance", () => {
    const result = nonInferiorityTest({
      control: { mean: 50, stdDev: 0, n: 100 },
      treatment: { mean: 50, stdDev: 0, n: 100 },
      margin: 0.10,
    });

    expect(result.nonInferior).toBe(true);
    expect(result.observedDiff).toBe(0);
  });

  it("computes one-sided CI lower bound", () => {
    const result = nonInferiorityTest({
      control: { mean: 100, stdDev: 20, n: 500 },
      treatment: { mean: 98, stdDev: 20, n: 500 },
      margin: 0.10,
    });

    // CI lower bound should be finite, upper should be Infinity
    expect(result.ci.lower).toBeLessThan(0);
    expect(result.ci.upper).toBe(Infinity);
  });
});
