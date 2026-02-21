import { describe, it, expect } from "vitest";
import { checkMaturity } from "../../src/stats/maturity.js";

describe("checkMaturity", () => {
  it("reports not ready when experiment just started", () => {
    const result = checkMaturity({
      experimentStartDate: "2026-01-15",
      variants: [
        { key: "control", trialDays: 14 },
        { key: "short", trialDays: 3 },
        { key: "medium", trialDays: 7 },
      ],
      observationWindowDays: 30,
      currentDate: "2026-01-20", // Only 5 days in
    });

    expect(result.ready).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    // No variant should have mature users yet (shortest needs 33 days)
    expect(result.variantMaturity.every((v) => v.pctMature === 0)).toBe(true);
  });

  it("reports ready when all variants have matured", () => {
    const result = checkMaturity({
      experimentStartDate: "2026-01-15",
      variants: [
        { key: "control", trialDays: 14 },
        { key: "short", trialDays: 3 },
      ],
      observationWindowDays: 30,
      currentDate: "2026-03-30", // Well past both maturity dates
    });

    expect(result.ready).toBe(true);
    expect(result.variantMaturity.every((v) => v.pctMature > 0)).toBe(true);
  });

  it("computes correct total days needed per variant", () => {
    const result = checkMaturity({
      experimentStartDate: "2026-01-15",
      variants: [
        { key: "control", trialDays: 14 },
        { key: "short", trialDays: 3 },
        { key: "medium", trialDays: 7 },
      ],
      observationWindowDays: 30,
      currentDate: "2026-02-20",
    });

    const control = result.variantMaturity.find((v) => v.key === "control")!;
    const short = result.variantMaturity.find((v) => v.key === "short")!;
    const medium = result.variantMaturity.find((v) => v.key === "medium")!;

    expect(control.totalDaysNeeded).toBe(44); // 14 + 30
    expect(short.totalDaysNeeded).toBe(33);  // 3 + 30
    expect(medium.totalDaysNeeded).toBe(37); // 7 + 30
  });

  it("computes fair comparison date from slowest variant", () => {
    const result = checkMaturity({
      experimentStartDate: "2026-01-15",
      variants: [
        { key: "control", trialDays: 14 },
        { key: "short", trialDays: 3 },
      ],
      observationWindowDays: 30,
      currentDate: "2026-02-20",
    });

    // Fair date = start + max(14+30, 3+30) = start + 44 = 2026-02-28
    expect(result.fairComparisonDate).toBe("2026-02-28");
  });

  it("warns about maturity imbalance", () => {
    const result = checkMaturity({
      experimentStartDate: "2026-01-15",
      variants: [
        { key: "control", trialDays: 14 },
        { key: "short", trialDays: 3 },
      ],
      observationWindowDays: 30,
      currentDate: "2026-02-25", // Short is mature, control barely starting
    });

    // Short trial users (33 days) should have some mature, control (44 days) fewer
    const short = result.variantMaturity.find((v) => v.key === "short")!;
    const control = result.variantMaturity.find((v) => v.key === "control")!;

    expect(short.pctMature).toBeGreaterThan(control.pctMature);
  });

  it("handles experiment not yet started", () => {
    const result = checkMaturity({
      experimentStartDate: "2026-03-01",
      variants: [{ key: "control", trialDays: 14 }],
      observationWindowDays: 30,
      currentDate: "2026-02-20",
    });

    expect(result.ready).toBe(false);
    expect(result.warnings).toContain("Experiment has not started yet.");
  });

  it("computes first full read date correctly", () => {
    const result = checkMaturity({
      experimentStartDate: "2026-01-15",
      variants: [
        { key: "short", trialDays: 3 },
      ],
      observationWindowDays: 30,
      currentDate: "2026-02-20",
    });

    // First user registered 2026-01-15, needs 33 days → 2026-02-17
    expect(result.variantMaturity[0].firstFullReadDate).toBe("2026-02-17");
  });
});
