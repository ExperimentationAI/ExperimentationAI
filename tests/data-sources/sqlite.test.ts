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
      // Insert test data
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
      const insert = "INSERT INTO events (experiment_key, variant_key, event_name, user_id, value, timestamp) VALUES (?, ?, ?, ?, ?, ?)";
      await ds.executeQuery(insert, ["exp1", "control", "purchase", "u1", 10.5, "2025-01-15T10:00:00Z"]);
      await ds.executeQuery(insert, ["exp1", "control", "purchase", "u2", 20.0, "2025-01-16T10:00:00Z"]);
      await ds.executeQuery(insert, ["exp1", "treatment", "purchase", "u3", 15.0, "2025-01-17T10:00:00Z"]);
      await ds.executeQuery(insert, ["exp1", "control", "page_view", "u4", null, "2025-01-15T12:00:00Z"]);
      await ds.executeQuery(insert, ["exp1", "treatment", "purchase", "u5", 30.0, "2025-01-20T10:00:00Z"]);
    });

    it("returns events for experiment and event name", async () => {
      const result = await ds.getEventData({
        experimentKey: "exp1",
        eventName: "purchase",
      });
      expect(result.rowCount).toBe(4);
    });

    it("filters by variant", async () => {
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
    it("populates all tables correctly", () => {
      // Close the default ds, use seeded one
      ds.close();
      ds = seedDatabase(":memory:");

      // Check metrics were seeded
      const metricsPromise = ds.listMetrics();
      return metricsPromise.then(async (metrics) => {
        expect(metrics.length).toBe(5);
        const metricKeys = metrics.map((m) => m.key);
        expect(metricKeys).toContain("conversion_rate");
        expect(metricKeys).toContain("revenue_per_user");
        expect(metricKeys).toContain("cart_abandonment");
        expect(metricKeys).toContain("click_through_rate");
        expect(metricKeys).toContain("avg_session_duration");

        // Check experiments
        const expResult = await ds.executeQuery(
          "SELECT * FROM experiments ORDER BY key"
        );
        expect(expResult.rowCount).toBe(2);

        // Check experiment metrics for checkout-redesign
        const crMetrics = await ds.getExperimentMetrics("checkout-redesign", [
          "conversion_rate",
          "revenue_per_user",
          "cart_abandonment",
        ]);
        expect(crMetrics).toHaveLength(3);

        const convRate = crMetrics.find((m) => m.metricKey === "conversion_rate")!;
        expect(convRate.metricType).toBe("binary");
        expect(convRate.variants).toHaveLength(2);
        const control = convRate.variants.find((v) => v.variantKey === "control")!;
        expect(control.sampleSize).toBe(1000);
        expect(control.successes).toBe(120);

        // Check experiment metrics for search-ranking-v2
        const srMetrics = await ds.getExperimentMetrics("search-ranking-v2", [
          "click_through_rate",
          "avg_session_duration",
        ]);
        expect(srMetrics).toHaveLength(2);
        const ctr = srMetrics.find((m) => m.metricKey === "click_through_rate")!;
        expect(ctr.variants).toHaveLength(3);

        // Check events
        const eventsResult = await ds.executeQuery(
          "SELECT COUNT(*) AS cnt FROM events"
        );
        expect(eventsResult.rows[0].cnt).toBe(200);

        // Check events are distributed across experiments
        const exp1Events = await ds.executeQuery(
          "SELECT COUNT(*) AS cnt FROM events WHERE experiment_key = ?",
          ["checkout-redesign"]
        );
        expect(exp1Events.rows[0].cnt).toBe(100);

        const exp2Events = await ds.executeQuery(
          "SELECT COUNT(*) AS cnt FROM events WHERE experiment_key = ?",
          ["search-ranking-v2"]
        );
        expect(exp2Events.rows[0].cnt).toBe(100);
      });
    });
  });
});
