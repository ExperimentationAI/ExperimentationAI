import { describe, it, expect } from "vitest";
import { multiArmAnalysis } from "../../src/stats/multi-arm.js";

describe("multiArmAnalysis", () => {
  it("identifies a non-inferior challenger", () => {
    const result = multiArmAnalysis({
      variants: [
        { key: "control", n: 1000, mean: 100, stdDev: 25 },
        { key: "short_trial", n: 2000, mean: 98, stdDev: 25 },
      ],
      controlKey: "control",
      margin: 0.10,
    });

    expect(result.pairwise).toHaveLength(1);
    expect(result.pairwise[0].nonInferior).toBe(true);
    expect(result.winner).toBe("short_trial");
    expect(result.correctionMethod).toBe("Holm-Bonferroni");
  });

  it("handles 3-arm experiment", () => {
    const result = multiArmAnalysis({
      variants: [
        { key: "control", n: 1000, mean: 100, stdDev: 25 },
        { key: "3day", n: 2000, mean: 97, stdDev: 25 },
        { key: "7day", n: 2000, mean: 99, stdDev: 25 },
      ],
      controlKey: "control",
      margin: 0.10,
    });

    expect(result.pairwise).toHaveLength(2);
    // Both should pass — they're within 10% of control
    expect(result.pairwise.every((p) => p.nonInferior)).toBe(true);
    expect(result.winner).toBeDefined();
    expect(result.recommendation).toContain("pass");
  });

  it("applies Holm-Bonferroni correction", () => {
    const result = multiArmAnalysis({
      variants: [
        { key: "control", n: 1000, mean: 100, stdDev: 25 },
        { key: "variant_a", n: 2000, mean: 97, stdDev: 25 },
        { key: "variant_b", n: 2000, mean: 98, stdDev: 25 },
      ],
      controlKey: "control",
      margin: 0.10,
    });

    // Adjusted p-values should be >= raw p-values
    for (const pair of result.pairwise) {
      expect(pair.adjustedPValue).toBeGreaterThanOrEqual(pair.rawPValue);
    }
  });

  it("rejects when challenger is clearly inferior", () => {
    const result = multiArmAnalysis({
      variants: [
        { key: "control", n: 1000, mean: 100, stdDev: 15 },
        { key: "bad_variant", n: 2000, mean: 80, stdDev: 15 },
      ],
      controlKey: "control",
      margin: 0.10,
    });

    expect(result.pairwise[0].nonInferior).toBe(false);
    expect(result.winner).toBeNull();
    expect(result.recommendation).toContain("control");
  });

  it("handles binary metrics", () => {
    const result = multiArmAnalysis({
      variants: [
        { key: "control", n: 5000, mean: 0.42, stdDev: 0.49, successes: 2100 },
        { key: "treatment", n: 10000, mean: 0.41, stdDev: 0.49, successes: 4100 },
      ],
      controlKey: "control",
      margin: 0.10,
      metricType: "binary",
    });

    expect(result.pairwise).toHaveLength(1);
    // 41% vs 42% is within 10% relative margin (4.2pp)
    expect(result.pairwise[0].nonInferior).toBe(true);
  });

  it("throws when control not found", () => {
    expect(() =>
      multiArmAnalysis({
        variants: [{ key: "a", n: 100, mean: 50, stdDev: 10 }],
        controlKey: "missing",
        margin: 0.10,
      })
    ).toThrow("not found");
  });

  it("throws when no challengers", () => {
    expect(() =>
      multiArmAnalysis({
        variants: [{ key: "control", n: 100, mean: 50, stdDev: 10 }],
        controlKey: "control",
        margin: 0.10,
      })
    ).toThrow("At least one challenger");
  });
});
