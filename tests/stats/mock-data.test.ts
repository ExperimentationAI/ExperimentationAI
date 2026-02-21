import { describe, it, expect } from "vitest";
import { generateTrialExperiment, DEFAULT_CONFIG } from "../../src/mock/trial-experiment.js";
import { MockDataSource } from "../../src/data-sources/mock.js";

describe("generateTrialExperiment", () => {
  it("generates the expected number of users", () => {
    const users = generateTrialExperiment();
    // 2193 * 45 days ≈ 98,685
    expect(users.length).toBe(DEFAULT_CONFIG.dailyRegistrants * DEFAULT_CONFIG.durationDays);
  });

  it("assigns variants with correct proportions", () => {
    const users = generateTrialExperiment();
    const counts = new Map<string, number>();
    for (const u of users) {
      counts.set(u.variant, (counts.get(u.variant) ?? 0) + 1);
    }

    const total = users.length;
    // 20% control, 40% each treatment (with some variance)
    expect(counts.get("control")! / total).toBeCloseTo(0.20, 1);
    expect(counts.get("short_trial")! / total).toBeCloseTo(0.40, 1);
    expect(counts.get("medium_trial")! / total).toBeCloseTo(0.40, 1);
  });

  it("produces deterministic results with same seed", () => {
    const a = generateTrialExperiment({ ...DEFAULT_CONFIG, durationDays: 2 });
    const b = generateTrialExperiment({ ...DEFAULT_CONFIG, durationDays: 2 });
    expect(a.length).toBe(b.length);
    expect(a[0].userId).toBe(b[0].userId);
    expect(a[0].variant).toBe(b[0].variant);
    expect(a[0].trialStarted).toBe(b[0].trialStarted);
  });

  it("has realistic baseline rates", () => {
    const users = generateTrialExperiment();
    const control = users.filter((u) => u.variant === "control");

    const trialStartRate = control.filter((u) => u.trialStarted).length / control.length;
    expect(trialStartRate).toBeCloseTo(0.17, 1);

    const starters = control.filter((u) => u.trialStarted);
    const convRate = starters.filter((u) => u.converted).length / starters.length;
    expect(convRate).toBeCloseTo(0.42, 1);
  });
});

describe("MockDataSource", () => {
  it("implements DataSource interface", async () => {
    const ds = new MockDataSource();
    expect(await ds.healthCheck()).toBe(true);
  });

  it("returns metrics for known metric keys", async () => {
    const ds = new MockDataSource();
    const metrics = await ds.getExperimentMetrics("trial-length", [
      "ltv_30d",
      "conversion_rate",
      "retention_1month",
      "refund_rate",
      "trial_start_rate",
    ]);

    expect(metrics).toHaveLength(5);
    for (const m of metrics) {
      expect(m.variants.length).toBeGreaterThan(0);
      for (const v of m.variants) {
        expect(v.sampleSize).toBeGreaterThan(0);
      }
    }
  });

  it("lists available metrics", async () => {
    const ds = new MockDataSource();
    const defs = await ds.listMetrics();

    expect(defs.length).toBeGreaterThanOrEqual(5);
    expect(defs.find((d) => d.key === "ltv_30d")).toBeDefined();
    expect(defs.find((d) => d.key === "conversion_rate")).toBeDefined();
  });

  it("executes funnel query", async () => {
    const ds = new MockDataSource();
    const result = await ds.executeQuery("SELECT funnel stages by variant");

    expect(result.columns).toContain("variant");
    expect(result.columns).toContain("registered");
    expect(result.rowCount).toBe(3); // 3 variants
  });

  it("filters event data by variant", async () => {
    const ds = new MockDataSource();
    const result = await ds.getEventData({
      experimentKey: "trial-length",
      eventName: "registration",
      variantKey: "control",
    });

    for (const row of result.rows) {
      expect((row as any).variant).toBe("control");
    }
  });
});
