import { describe, it, expect } from "vitest";
import { checkGuardrails } from "../../src/stats/guardrails.js";

describe("checkGuardrails", () => {
  it("passes when metric is well within bounds", () => {
    const results = checkGuardrails([
      {
        metric: "retention",
        controlStats: { mean: 0.64, stdDev: 0.48, n: 2000 },
        treatmentStats: { mean: 0.63, stdDev: 0.48, n: 4000 },
        threshold: 0.05, // 5% relative
        thresholdType: "relative",
        direction: "no_decrease",
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].interpretation).toContain("PASS");
  });

  it("fails when metric clearly violates threshold", () => {
    const results = checkGuardrails([
      {
        metric: "retention",
        controlStats: { mean: 0.64, stdDev: 0.48, n: 5000 },
        treatmentStats: { mean: 0.50, stdDev: 0.50, n: 5000 },
        threshold: 0.05, // 5% relative = 3.2pp
        thresholdType: "relative",
        direction: "no_decrease",
      },
    ]);

    expect(results[0].status).toBe("fail");
    expect(results[0].interpretation).toContain("FAIL");
  });

  it("returns inconclusive when sample is too small", () => {
    const results = checkGuardrails([
      {
        metric: "retention",
        controlStats: { mean: 0.64, stdDev: 0.48, n: 50 },
        treatmentStats: { mean: 0.60, stdDev: 0.49, n: 50 },
        threshold: 0.05,
        thresholdType: "relative",
        direction: "no_decrease",
      },
    ]);

    expect(results[0].status).toBe("inconclusive");
    expect(results[0].interpretation).toContain("INCONCLUSIVE");
  });

  it("checks no_increase direction correctly", () => {
    // Refund rate: treatment is 5%, control is 3%, threshold is 1pp absolute
    const results = checkGuardrails([
      {
        metric: "refund_rate",
        controlStats: { mean: 0.03, stdDev: 0.17, n: 2000 },
        treatmentStats: { mean: 0.05, stdDev: 0.22, n: 4000 },
        threshold: 0.01, // 1pp absolute
        thresholdType: "absolute",
        direction: "no_increase",
      },
    ]);

    // 2pp increase exceeds 1pp threshold
    expect(results[0].status).toBe("fail");
  });

  it("passes no_increase when within bounds", () => {
    const results = checkGuardrails([
      {
        metric: "refund_rate",
        controlStats: { mean: 0.03, stdDev: 0.17, n: 2000 },
        treatmentStats: { mean: 0.032, stdDev: 0.18, n: 4000 },
        threshold: 0.01,
        thresholdType: "absolute",
        direction: "no_increase",
      },
    ]);

    expect(results[0].status).toBe("pass");
  });

  it("checks multiple guardrails at once", () => {
    const results = checkGuardrails([
      {
        metric: "retention",
        controlStats: { mean: 0.64, stdDev: 0.48, n: 2000 },
        treatmentStats: { mean: 0.63, stdDev: 0.48, n: 4000 },
        threshold: 0.05,
        thresholdType: "relative",
        direction: "no_decrease",
      },
      {
        metric: "refund_rate",
        controlStats: { mean: 0.03, stdDev: 0.17, n: 2000 },
        treatmentStats: { mean: 0.035, stdDev: 0.18, n: 4000 },
        threshold: 0.01,
        thresholdType: "absolute",
        direction: "no_increase",
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].metric).toBe("retention");
    expect(results[1].metric).toBe("refund_rate");
  });

  it("includes power in results", () => {
    const results = checkGuardrails([
      {
        metric: "retention",
        controlStats: { mean: 0.64, stdDev: 0.48, n: 500 },
        treatmentStats: { mean: 0.62, stdDev: 0.49, n: 500 },
        threshold: 0.05,
        thresholdType: "relative",
        direction: "no_decrease",
      },
    ]);

    expect(results[0].power).toBeGreaterThan(0);
    expect(results[0].power).toBeLessThanOrEqual(1);
  });

  it("handles zero variance", () => {
    const results = checkGuardrails([
      {
        metric: "test",
        controlStats: { mean: 0.50, stdDev: 0, n: 100 },
        treatmentStats: { mean: 0.50, stdDev: 0, n: 100 },
        threshold: 0.05,
        thresholdType: "relative",
        direction: "no_decrease",
      },
    ]);

    expect(results[0].status).toBe("pass");
  });
});
