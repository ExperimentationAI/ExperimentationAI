import type {
  DataSource,
  EventDataOptions,
  ExperimentMetricData,
  MetricDefinition,
  QueryResult,
} from "../interfaces/data-source.js";
import {
  generateTrialExperiment,
  summarizeByVariant,
  type ExperimentConfig,
  type MockUser,
  DEFAULT_CONFIG,
} from "../mock/trial-experiment.js";

/**
 * MockDataSource serves simulated trial experiment data.
 * Implements the DataSource interface so the agent can query it like a real database.
 */
export class MockDataSource implements DataSource {
  private users: MockUser[];
  private config: ExperimentConfig;

  constructor(config?: ExperimentConfig) {
    this.config = config ?? DEFAULT_CONFIG;
    this.users = generateTrialExperiment(this.config);
  }

  async executeQuery(sql: string, _params?: unknown[]): Promise<QueryResult> {
    const sqlLower = sql.toLowerCase().trim();

    // Support a few common query patterns
    if (sqlLower.includes("count") && sqlLower.includes("variant")) {
      return this.queryVariantCounts();
    }

    if (sqlLower.includes("funnel") || sqlLower.includes("stage")) {
      return this.queryFunnelData();
    }

    if (sqlLower.includes("revenue") || sqlLower.includes("ltv")) {
      return this.queryRevenueData();
    }

    if (sqlLower.includes("retention")) {
      return this.queryRetentionData();
    }

    if (sqlLower.includes("refund")) {
      return this.queryRefundData();
    }

    // Default: return raw user data (limited)
    const limit = 100;
    const rows = this.users.slice(0, limit).map((u) => ({ ...u }));
    return {
      columns: Object.keys(rows[0] || {}),
      rows,
      rowCount: rows.length,
    };
  }

  async getExperimentMetrics(
    _experimentKey: string,
    metricKeys: string[],
  ): Promise<ExperimentMetricData[]> {
    const results: ExperimentMetricData[] = [];

    for (const key of metricKeys) {
      switch (key) {
        case "ltv_30d":
        case "revenue_30d": {
          const stats = summarizeByVariant(
            this.users,
            (u) => u.revenue30d,
            (u) => u.trialStarted,
          );
          results.push({
            metricKey: key,
            metricType: "continuous",
            variants: Array.from(stats.entries()).map(([k, v]) => ({
              variantKey: k,
              sampleSize: v.n,
              mean: v.mean,
              stdDev: v.stdDev,
            })),
          });
          break;
        }

        case "conversion_rate":
        case "trial_to_paid": {
          const stats = summarizeByVariant(
            this.users,
            (u) => u.converted,
            (u) => u.trialStarted,
          );
          results.push({
            metricKey: key,
            metricType: "binary",
            variants: Array.from(stats.entries()).map(([k, v]) => ({
              variantKey: k,
              sampleSize: v.n,
              mean: v.mean,
              stdDev: v.stdDev,
              successes: v.successes,
            })),
          });
          break;
        }

        case "retention_1month": {
          const stats = summarizeByVariant(
            this.users,
            (u) => u.retained1month,
            (u) => u.converted,
          );
          results.push({
            metricKey: key,
            metricType: "binary",
            variants: Array.from(stats.entries()).map(([k, v]) => ({
              variantKey: k,
              sampleSize: v.n,
              mean: v.mean,
              stdDev: v.stdDev,
              successes: v.successes,
            })),
          });
          break;
        }

        case "refund_rate": {
          const stats = summarizeByVariant(
            this.users,
            (u) => u.refunded,
            (u) => u.converted,
          );
          results.push({
            metricKey: key,
            metricType: "binary",
            variants: Array.from(stats.entries()).map(([k, v]) => ({
              variantKey: k,
              sampleSize: v.n,
              mean: v.mean,
              stdDev: v.stdDev,
              successes: v.successes,
            })),
          });
          break;
        }

        case "trial_start_rate":
        case "reg_to_trial": {
          const stats = summarizeByVariant(
            this.users,
            (u) => u.trialStarted,
          );
          results.push({
            metricKey: key,
            metricType: "binary",
            variants: Array.from(stats.entries()).map(([k, v]) => ({
              variantKey: k,
              sampleSize: v.n,
              mean: v.mean,
              stdDev: v.stdDev,
              successes: v.successes,
            })),
          });
          break;
        }

        default: {
          // Unknown metric — return empty
          results.push({
            metricKey: key,
            metricType: "continuous",
            variants: [],
          });
        }
      }
    }

    return results;
  }

  async getEventData(options: EventDataOptions): Promise<QueryResult> {
    let filtered = this.users;

    if (options.variantKey) {
      filtered = filtered.filter((u) => u.variant === options.variantKey);
    }
    if (options.startDate) {
      filtered = filtered.filter((u) => u.registrationDate >= options.startDate!);
    }
    if (options.endDate) {
      filtered = filtered.filter((u) => u.registrationDate <= options.endDate!);
    }

    const limit = options.limit ?? 1000;
    const rows = filtered.slice(0, limit).map((u) => ({ ...u }));

    return {
      columns: Object.keys(rows[0] || {}),
      rows,
      rowCount: rows.length,
    };
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return [
      { key: "ltv_30d", name: "30-Day LTV", description: "Revenue per trial starter over 30 days", type: "continuous" },
      { key: "trial_start_rate", name: "Trial Start Rate", description: "Registration to trial start", type: "binary" },
      { key: "conversion_rate", name: "Conversion Rate", description: "Trial to paid conversion", type: "binary" },
      { key: "retention_1month", name: "1-Month Retention", description: "Retained at 1 month post-conversion", type: "binary" },
      { key: "refund_rate", name: "Refund Rate", description: "Refund rate among converters", type: "binary" },
    ];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /** Get raw users for direct access */
  getUsers(): MockUser[] {
    return this.users;
  }

  private queryVariantCounts(): QueryResult {
    const counts = new Map<string, number>();
    for (const u of this.users) {
      counts.set(u.variant, (counts.get(u.variant) ?? 0) + 1);
    }
    const rows = Array.from(counts.entries()).map(([variant, count]) => ({ variant, count }));
    return { columns: ["variant", "count"], rows, rowCount: rows.length };
  }

  private queryFunnelData(): QueryResult {
    const variants = [...new Set(this.users.map((u) => u.variant))];
    const rows = variants.map((variant) => {
      const varUsers = this.users.filter((u) => u.variant === variant);
      return {
        variant,
        registered: varUsers.length,
        trial_started: varUsers.filter((u) => u.trialStarted).length,
        converted: varUsers.filter((u) => u.converted).length,
        retained: varUsers.filter((u) => u.retained1month).length,
      };
    });
    return {
      columns: ["variant", "registered", "trial_started", "converted", "retained"],
      rows,
      rowCount: rows.length,
    };
  }

  private queryRevenueData(): QueryResult {
    const variants = [...new Set(this.users.map((u) => u.variant))];
    const rows = variants.map((variant) => {
      const starters = this.users.filter((u) => u.variant === variant && u.trialStarted);
      const revenues = starters.map((u) => u.revenue30d);
      const n = revenues.length;
      const mean = revenues.reduce((a, b) => a + b, 0) / (n || 1);
      const variance = revenues.reduce((a, b) => a + (b - mean) ** 2, 0) / ((n - 1) || 1);
      return { variant, n, mean_revenue: Math.round(mean * 100) / 100, std_revenue: Math.round(Math.sqrt(variance) * 100) / 100 };
    });
    return {
      columns: ["variant", "n", "mean_revenue", "std_revenue"],
      rows,
      rowCount: rows.length,
    };
  }

  private queryRetentionData(): QueryResult {
    const variants = [...new Set(this.users.map((u) => u.variant))];
    const rows = variants.map((variant) => {
      const converters = this.users.filter((u) => u.variant === variant && u.converted);
      const retained = converters.filter((u) => u.retained1month).length;
      return {
        variant,
        converters: converters.length,
        retained,
        retention_rate: converters.length > 0 ? Math.round((retained / converters.length) * 10000) / 10000 : 0,
      };
    });
    return {
      columns: ["variant", "converters", "retained", "retention_rate"],
      rows,
      rowCount: rows.length,
    };
  }

  private queryRefundData(): QueryResult {
    const variants = [...new Set(this.users.map((u) => u.variant))];
    const rows = variants.map((variant) => {
      const converters = this.users.filter((u) => u.variant === variant && u.converted);
      const refunded = converters.filter((u) => u.refunded).length;
      return {
        variant,
        converters: converters.length,
        refunded,
        refund_rate: converters.length > 0 ? Math.round((refunded / converters.length) * 10000) / 10000 : 0,
      };
    });
    return {
      columns: ["variant", "converters", "refunded", "refund_rate"],
      rows,
      rowCount: rows.length,
    };
  }
}
