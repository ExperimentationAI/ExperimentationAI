import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDataSource } from "../../src/data-sources/sqlite.js";
import { seedDatabase } from "../../src/data-sources/sqlite-seed.js";

describe("SqliteDataSource", () => {
  let ds: SqliteDataSource;

  beforeEach(() => {
    ds = new SqliteDataSource(":memory:");
  });

  afterEach(() => {
    ds.close();
  });

  describe("constructor", () => {
    it("creates schema tables", async () => {
      const result = await ds.executeQuery(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      const tableNames = result.rows.map((r) => r.name);
      expect(tableNames).toContain("metrics");
      expect(tableNames).toContain("experiments");
      expect(tableNames).toContain("experiment_metrics");
      expect(tableNames).toContain("events");
      expect(tableNames).toContain("inclusion_logs");
    });
  });

  describe("executeQuery", () => {
    it("handles SELECT queries", async () => {
      const result = await ds.executeQuery("SELECT 1 AS val, 'hello' AS msg");
      expect(result.columns).toEqual(["val", "msg"]);
      expect(result.rows).toEqual([{ val: 1, msg: "hello" }]);
      expect(result.rowCount).toBe(1);
    });

    it("handles INSERT/write queries", async () => {
      const result = await ds.executeQuery(
        "INSERT INTO metrics (key, name, type) VALUES (?, ?, ?)",
        ["test_metric", "Test Metric", "binary"]
      );
      expect(result.columns).toEqual(["changes", "lastInsertRowid"]);
      expect(result.rows[0].changes).toBe(1);
    });

    it("handles PRAGMA queries", async () => {
      const result = await ds.executeQuery("PRAGMA table_info(metrics)");
      expect(result.rowCount).toBeGreaterThan(0);
      expect(result.columns).toContain("name");
    });

    it("handles parameterized queries", async () => {
      await ds.executeQuery(
        "INSERT INTO metrics (key, name, type) VALUES (?, ?, ?)",
        ["m1", "Metric 1", "continuous"]
      );
      const result = await ds.executeQuery(
        "SELECT * FROM metrics WHERE key = ?",
        ["m1"]
      );
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].key).toBe("m1");
    });
  });

  describe("getExperimentMetrics", () => {
    beforeEach(async () => {
      await ds.executeQuery(
        "INSERT INTO metrics (key, name, type) VALUES (?, ?, ?)",
        ["conv", "Conversion", "binary"]
      );
      await ds.executeQuery(
        "INSERT INTO metrics (key, name, type) VALUES (?, ?, ?)",
        ["rev", "Revenue", "continuous"]
      );
      await ds.executeQuery(
        "INSERT INTO experiments (key, name) VALUES (?, ?)",
        ["exp1", "Experiment 1"]
      );
      await ds.executeQuery(
        "INSERT INTO experiment_metrics (experiment_key, metric_key, variant_key, sample_size, mean, std_dev, successes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["exp1", "conv", "control", 1000, 0.12, 0, 120]
      );
      await ds.executeQuery(
        "INSERT INTO experiment_metrics (experiment_key, metric_key, variant_key, sample_size, mean, std_dev, successes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["exp1", "conv", "treatment", 1000, 0.15, 0, 150]
      );
      await ds.executeQuery(
        "INSERT INTO experiment_metrics (experiment_key, metric_key, variant_key, sample_size, mean, std_dev, successes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["exp1", "rev", "control", 1000, 4.2, 2.5, null]
      );
      await ds.executeQuery(
        "INSERT INTO experiment_metrics (experiment_key, metric_key, variant_key, sample_size, mean, std_dev, successes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["exp1", "rev", "treatment", 1000, 4.8, 2.8, null]
      );
    });

    it("returns grouped metric data", async () => {
      const results = await ds.getExperimentMetrics("exp1", ["conv", "rev"]);
      expect(results).toHaveLength(2);

      const conv = results.find((r) => r.metricKey === "conv")!;
      expect(conv.metricType).toBe("binary");
      expect(conv.variants).toHaveLength(2);
      expect(conv.variants[0].variantKey).toBe("control");
      expect(conv.variants[0].sampleSize).toBe(1000);
      expect(conv.variants[0].successes).toBe(120);

      const rev = results.find((r) => r.metricKey === "rev")!;
      expect(rev.metricType).toBe("continuous");
      expect(rev.variants).toHaveLength(2);
      expect(rev.variants[0].stdDev).toBe(2.5);
      expect(rev.variants[0].successes).toBeUndefined();
    });

    it("returns empty for unknown experiment", async () => {
      const results = await ds.getExperimentMetrics("nonexistent", ["conv"]);
      expect(results).toHaveLength(0);
    });

    it("filters by metric keys", async () => {
      const results = await ds.getExperimentMetrics("exp1", ["conv"]);
      expect(results).toHaveLength(1);
      expect(results[0].metricKey).toBe("conv");
    });
  });

  describe("getEventData", () => {
    beforeEach(async () => {
      // Insert experiment first (FK target)
      await ds.executeQuery(
        "INSERT INTO experiments (key, name) VALUES (?, ?)",
        ["exp1", "Experiment 1"]
      );

      // Insert inclusion_logs
      const ilInsert =
        "INSERT INTO inclusion_logs (experiment_key, variant_key, user_uuid, timestamp) VALUES (?, ?, ?, ?)";
      await ds.executeQuery(ilInsert, ["exp1", "control", "u1", "2025-01-15T10:00:00Z"]);
      await ds.executeQuery(ilInsert, ["exp1", "control", "u2", "2025-01-16T10:00:00Z"]);
      await ds.executeQuery(ilInsert, ["exp1", "treatment", "u3", "2025-01-17T10:00:00Z"]);
      await ds.executeQuery(ilInsert, ["exp1", "control", "u4", "2025-01-15T12:00:00Z"]);
      await ds.executeQuery(ilInsert, ["exp1", "treatment", "u5", "2025-01-20T10:00:00Z"]);

      // Insert events (mobile-style, no experiment/variant columns)
      const evInsert =
        "INSERT INTO events (timestamp, event_name, user_uuid, event_value, event_params) VALUES (?, ?, ?, ?, ?)";
      await ds.executeQuery(evInsert, ["2025-01-15T10:00:00Z", "purchase", "u1", 10.5, null]);
      await ds.executeQuery(evInsert, ["2025-01-16T10:00:00Z", "purchase", "u2", 20.0, null]);
      await ds.executeQuery(evInsert, ["2025-01-17T10:00:00Z", "purchase", "u3", 15.0, null]);
      await ds.executeQuery(evInsert, ["2025-01-15T12:00:00Z", "page_view", "u4", null, null]);
      await ds.executeQuery(evInsert, ["2025-01-20T10:00:00Z", "purchase", "u5", 30.0, null]);
    });

    it("returns events for experiment and event name via JOIN", async () => {
      const result = await ds.getEventData({
        experimentKey: "exp1",
        eventName: "purchase",
      });
      expect(result.rowCount).toBe(4);
      // Verify JOIN populates variant_key and experiment_key
      for (const row of result.rows) {
        expect(row.variant_key).toBeDefined();
        expect(row.experiment_key).toBe("exp1");
      }
    });

    it("filters by variant via inclusion_logs", async () => {
      const result = await ds.getEventData({
        experimentKey: "exp1",
        eventName: "purchase",
        variantKey: "control",
      });
      expect(result.rowCount).toBe(2);
      for (const row of result.rows) {
        expect(row.variant_key).toBe("control");
      }
    });

    it("filters by date range", async () => {
      const result = await ds.getEventData({
        experimentKey: "exp1",
        eventName: "purchase",
        startDate: "2025-01-16T00:00:00Z",
        endDate: "2025-01-18T00:00:00Z",
      });
      expect(result.rowCount).toBe(2);
    });

    it("respects limit", async () => {
      const result = await ds.getEventData({
        experimentKey: "exp1",
        eventName: "purchase",
        limit: 2,
      });
      expect(result.rowCount).toBe(2);
    });

    it("returns empty for unknown event name", async () => {
      const result = await ds.getEventData({
        experimentKey: "exp1",
        eventName: "nonexistent",
      });
      expect(result.rowCount).toBe(0);
    });
  });

  describe("listMetrics", () => {
    it("returns all metrics", async () => {
      await ds.executeQuery(
        "INSERT INTO metrics (key, name, description, type) VALUES (?, ?, ?, ?)",
        ["m1", "Metric 1", "Description 1", "binary"]
      );
      await ds.executeQuery(
        "INSERT INTO metrics (key, name, type) VALUES (?, ?, ?)",
        ["m2", "Metric 2", "continuous"]
      );

      const metrics = await ds.listMetrics();
      expect(metrics).toHaveLength(2);
      expect(metrics[0]).toEqual({
        key: "m1",
        name: "Metric 1",
        description: "Description 1",
        type: "binary",
      });
      expect(metrics[1]).toEqual({
        key: "m2",
        name: "Metric 2",
        type: "continuous",
      });
    });

    it("returns empty when no metrics exist", async () => {
      const metrics = await ds.listMetrics();
      expect(metrics).toHaveLength(0);
    });
  });

  describe("healthCheck", () => {
    it("returns true", async () => {
      const healthy = await ds.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  describe("seedDatabase", () => {
    it("populates all tables correctly", async () => {
      ds.close();
      ds = seedDatabase(":memory:");

      // 8 metrics
      const metrics = await ds.listMetrics();
      expect(metrics.length).toBe(8);
      const metricKeys = metrics.map((m) => m.key);
      expect(metricKeys).toContain("ltv_30d");
      expect(metricKeys).toContain("trial_start_rate");
      expect(metricKeys).toContain("conversion_rate");
      expect(metricKeys).toContain("retention_1month");
      expect(metricKeys).toContain("refund_rate");
      expect(metricKeys).toContain("time_to_conversion");
      expect(metricKeys).toContain("support_tickets_per_reg");
      expect(metricKeys).toContain("activation_rate");

      // 1 experiment
      const expResult = await ds.executeQuery(
        "SELECT * FROM experiments ORDER BY key"
      );
      expect(expResult.rowCount).toBe(1);
      expect(expResult.rows[0].key).toBe("trial-length");

      // 3 variants × 8 metrics = 24 experiment_metrics rows
      const emResult = await ds.executeQuery(
        "SELECT COUNT(*) AS cnt FROM experiment_metrics WHERE experiment_key = ?",
        ["trial-length"]
      );
      expect(emResult.rows[0].cnt).toBe(24);

      // Each metric has 3 variants
      const crMetrics = await ds.getExperimentMetrics("trial-length", [
        "conversion_rate",
        "trial_start_rate",
        "retention_1month",
      ]);
      expect(crMetrics).toHaveLength(3);
      for (const m of crMetrics) {
        expect(m.variants).toHaveLength(3);
      }

      // ~98,685 inclusion_logs
      const ilResult = await ds.executeQuery(
        "SELECT COUNT(*) AS cnt FROM inclusion_logs"
      );
      const ilCount = ilResult.rows[0].cnt as number;
      expect(ilCount).toBe(2193 * 45); // 98,685

      // Many thousands of events
      const evResult = await ds.executeQuery(
        "SELECT COUNT(*) AS cnt FROM events"
      );
      const evCount = evResult.rows[0].cnt as number;
      expect(evCount).toBeGreaterThan(90000); // at least one registration event per user

      // Spot-check: control trial_start_rate ≈ 0.17
      const tsMetrics = await ds.getExperimentMetrics("trial-length", ["trial_start_rate"]);
      const controlTs = tsMetrics[0].variants.find((v) => v.variantKey === "control")!;
      expect(controlTs.mean).toBeCloseTo(0.17, 1);

      // Spot-check: control conversion_rate ≈ 0.42
      const convMetrics = await ds.getExperimentMetrics("trial-length", ["conversion_rate"]);
      const controlConv = convMetrics[0].variants.find((v) => v.variantKey === "control")!;
      expect(controlConv.mean).toBeCloseTo(0.42, 1);
    }, 30000); // 30s timeout for seed generation
  });
});
