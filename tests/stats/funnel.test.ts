import { describe, it, expect } from "vitest";
import { analyzeFunnel } from "../../src/stats/funnel.js";

describe("analyzeFunnel", () => {
  it("computes stage-by-stage conversion rates", () => {
    const result = analyzeFunnel({
      stages: ["Registered", "Trial", "Paid", "Retained"],
      variants: [
        { key: "control", counts: [10000, 1700, 714, 457] },
        { key: "short_trial", counts: [20000, 3230, 1560, 966] },
      ],
    });

    expect(result.variants).toHaveLength(2);

    const control = result.variants.find((v) => v.key === "control")!;
    expect(control.stages[0].rate).toBe(1.0); // First stage is always 100%
    expect(control.stages[1].rate).toBeCloseTo(0.17, 2); // 1700/10000
    expect(control.stages[2].rate).toBeCloseTo(714 / 1700, 2); // ~42%
    expect(control.stages[3].rate).toBeCloseTo(457 / 714, 2); // ~64%
  });

  it("computes end-to-end rates with CIs", () => {
    const result = analyzeFunnel({
      stages: ["Registered", "Trial", "Paid"],
      variants: [
        { key: "control", counts: [10000, 1700, 714] },
        { key: "treatment", counts: [20000, 3400, 1500] },
      ],
    });

    const control = result.variants.find((v) => v.key === "control")!;
    expect(control.endToEndRate).toBeCloseTo(714 / 10000, 4);
    expect(control.endToEndCI.lower).toBeLessThan(control.endToEndRate);
    expect(control.endToEndCI.upper).toBeGreaterThan(control.endToEndRate);
  });

  it("compares stages across variants", () => {
    const result = analyzeFunnel({
      stages: ["Registered", "Trial", "Paid"],
      variants: [
        { key: "control", counts: [10000, 1700, 714] },
        { key: "treatment", counts: [20000, 3600, 1728] },
      ],
    });

    // Comparisons for Trial and Paid stages (not Registered which is always 100%)
    expect(result.comparisons.length).toBeGreaterThanOrEqual(2);

    // Trial stage comparison: 17% vs 18%
    const trialComp = result.comparisons.find((c) => c.stage === "Trial")!;
    expect(trialComp.controlRate).toBeCloseTo(0.17, 2);
    expect(trialComp.variantRate).toBeCloseTo(0.18, 2);
    expect(trialComp.diff).toBeCloseTo(0.01, 2);
  });

  it("identifies bottleneck stage", () => {
    const result = analyzeFunnel({
      stages: ["Registered", "Trial", "Paid", "Retained"],
      variants: [
        { key: "control", counts: [10000, 1700, 714, 457] },
        // Short trial: same reg→trial but much higher trial→paid
        { key: "short", counts: [10000, 1700, 1000, 600] },
      ],
    });

    // The biggest difference is at the Paid stage (42% vs 59%)
    expect(result.bottleneck).toBe("Paid");
  });

  it("throws for fewer than 2 stages", () => {
    expect(() =>
      analyzeFunnel({
        stages: ["Only"],
        variants: [
          { key: "a", counts: [100] },
          { key: "b", counts: [200] },
        ],
      })
    ).toThrow("at least 2 stages");
  });

  it("throws for fewer than 2 variants", () => {
    expect(() =>
      analyzeFunnel({
        stages: ["A", "B"],
        variants: [{ key: "only", counts: [100, 50] }],
      })
    ).toThrow("at least 2 variants");
  });

  it("throws for mismatched counts/stages", () => {
    expect(() =>
      analyzeFunnel({
        stages: ["A", "B", "C"],
        variants: [
          { key: "a", counts: [100, 50] }, // Only 2 counts for 3 stages
          { key: "b", counts: [200, 100, 50] },
        ],
      })
    ).toThrow("counts");
  });

  it("produces interpretation with significant differences", () => {
    const result = analyzeFunnel({
      stages: ["Registered", "Trial", "Paid"],
      variants: [
        { key: "control", counts: [10000, 1700, 714] },
        { key: "treatment", counts: [10000, 1900, 900] },
      ],
    });

    expect(result.interpretation).toContain("End-to-end");
  });
});
