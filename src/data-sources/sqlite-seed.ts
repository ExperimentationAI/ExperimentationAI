import { SqliteDataSource } from "./sqlite.js";

// ---------------------------------------------------------------------------
// PRNG (mulberry32)
// ---------------------------------------------------------------------------

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Box-Muller transform for normal distribution */
  normal(mean: number, stdDev: number): number {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

interface VariantConfig {
  key: string;
  trialDays: number;
  allocationWeight: number;
  trialStartMult: number;
  conversionMult: number;
  retentionMult: number;
  refundDelta: number;
}

interface ExperimentConfig {
  startDate: string;
  durationDays: number;
  dailyRegistrants: number;
  baseTrialStartRate: number;
  baseConversionRate: number;
  baseRetentionRate: number;
  baseRefundRate: number;
  baseRevenue: number;
  revenueStdDev: number;
  variants: VariantConfig[];
  seed: number;
}

const DEFAULT_CONFIG: ExperimentConfig = {
  startDate: "2026-01-15",
  durationDays: 45,
  dailyRegistrants: 2193,
  baseTrialStartRate: 0.17,
  baseConversionRate: 0.42,
  baseRetentionRate: 0.64,
  baseRefundRate: 0.03,
  baseRevenue: 450,
  revenueStdDev: 180,
  variants: [
    {
      key: "control",
      trialDays: 14,
      allocationWeight: 0.20,
      trialStartMult: 1.0,
      conversionMult: 1.0,
      retentionMult: 1.0,
      refundDelta: 0,
    },
    {
      key: "short_trial",
      trialDays: 3,
      allocationWeight: 0.40,
      trialStartMult: 0.95,
      conversionMult: 1.15,
      retentionMult: 0.97,
      refundDelta: 0.005,
    },
    {
      key: "medium_trial",
      trialDays: 7,
      allocationWeight: 0.40,
      trialStartMult: 0.98,
      conversionMult: 1.08,
      retentionMult: 0.99,
      refundDelta: 0.002,
    },
  ],
  seed: 42,
};

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

const METRICS: Array<[string, string, string, string]> = [
  ["ltv_30d", "1-Month LTV per Registrant", "Revenue per registrant over 30 days (MXN)", "continuous"],
  ["trial_start_rate", "Registration → Trial Start Rate", "Fraction of registrants who start a trial", "binary"],
  ["conversion_rate", "Trial → Paid Conversion Rate", "Fraction of trial starters who convert to paid", "binary"],
  ["retention_1month", "1-Month Paid Retention", "Fraction of converters retained at 1 month", "binary"],
  ["refund_rate", "Refund Rate", "Fraction of converters who request a refund", "binary"],
  ["time_to_conversion", "Time to Conversion (days)", "Days from registration to paid conversion", "continuous"],
  ["support_tickets_per_reg", "Support Tickets per Registrant", "Average support tickets filed per registrant", "continuous"],
  ["activation_rate", "Activation Rate", "Fraction of trial starters who activate (use core feature)", "binary"],
];

// ---------------------------------------------------------------------------
// User record (in-memory, not persisted directly)
// ---------------------------------------------------------------------------

interface UserRecord {
  uuid: string;
  variant: string;
  registrationDate: string;
  trialStarted: boolean;
  trialStartDate: string | null;
  trialDays: number;
  converted: boolean;
  conversionDate: string | null;
  revenue30d: number;
  retained1month: boolean;
  refunded: boolean;
  supportTickets: number;
  activated: boolean;
  source: string;
}

// ---------------------------------------------------------------------------
// seedDatabase
// ---------------------------------------------------------------------------

export function seedDatabase(dbPath: string): SqliteDataSource {
  const ds = new SqliteDataSource(dbPath);
  const rng = new SeededRandom(DEFAULT_CONFIG.seed);
  const config = DEFAULT_CONFIG;

  // 1. Insert experiment + metric definitions
  ds.executeQuery("INSERT OR REPLACE INTO experiments (key, name) VALUES (?, ?)", [
    "trial-length",
    "Trial Length Optimization",
  ]);

  for (const [key, name, description, type] of METRICS) {
    ds.executeQuery(
      "INSERT OR REPLACE INTO metrics (key, name, description, type) VALUES (?, ?, ?, ?)",
      [key, name, description, type],
    );
  }

  // 2. Generate users, write inclusion_logs + events
  const users = generateUsers(ds, rng, config);

  // 3. Aggregate metrics and write experiment_metrics
  aggregateAndInsertMetrics(ds, users, config);

  return ds;
}

// ---------------------------------------------------------------------------
// User generation
// ---------------------------------------------------------------------------

function generateUsers(
  ds: SqliteDataSource,
  rng: SeededRandom,
  config: ExperimentConfig,
): UserRecord[] {
  const users: UserRecord[] = [];
  const startDate = new Date(config.startDate);
  let userId = 1;

  const sources = ["organic", "paid", "referral"];
  const sourceWeights = [0.5, 0.35, 0.15];

  // Prepare for batch inserts using raw db access via executeQuery
  const ilInsert = "INSERT INTO inclusion_logs (experiment_key, variant_key, user_uuid, timestamp) VALUES (?, ?, ?, ?)";
  const evInsert = "INSERT INTO events (timestamp, event_name, user_uuid, event_value, event_params) VALUES (?, ?, ?, ?, ?)";

  // Wrap in transaction for performance
  ds.executeQuery("BEGIN TRANSACTION");

  for (let day = 0; day < config.durationDays; day++) {
    const regDate = new Date(startDate);
    regDate.setDate(regDate.getDate() + day);
    const regDateStr = regDate.toISOString().split("T")[0];

    for (let i = 0; i < config.dailyRegistrants; i++) {
      const uuid = `user-${String(userId).padStart(6, "0")}`;

      // Assign variant
      const r = rng.next();
      let cumWeight = 0;
      let variant: VariantConfig | undefined;
      for (const v of config.variants) {
        cumWeight += v.allocationWeight;
        if (r < cumWeight) {
          variant = v;
          break;
        }
      }
      if (!variant) variant = config.variants[config.variants.length - 1];

      // Pick source
      const sourceRoll = rng.next();
      let cumSource = 0;
      let source = sources[0];
      for (let s = 0; s < sources.length; s++) {
        cumSource += sourceWeights[s];
        if (sourceRoll < cumSource) {
          source = sources[s];
          break;
        }
      }

      // Registration timestamp (random hour within the day)
      const regHour = Math.floor(rng.next() * 24);
      const regMin = Math.floor(rng.next() * 60);
      const regTs = `${regDateStr}T${String(regHour).padStart(2, "0")}:${String(regMin).padStart(2, "0")}:00Z`;

      // Write inclusion_log
      ds.executeQuery(ilInsert, ["trial-length", variant.key, uuid, regTs]);

      // Write registration event
      ds.executeQuery(evInsert, [
        regTs,
        "registration",
        uuid,
        null,
        JSON.stringify({ source }),
      ]);

      // Trial start?
      const trialStartRate = config.baseTrialStartRate * variant.trialStartMult;
      const trialStarted = rng.next() < trialStartRate;

      let trialStartDate: string | null = null;
      let converted = false;
      let conversionDate: string | null = null;
      let revenue30d = 0;
      let retained1month = false;
      let refunded = false;
      let supportTickets = 0;
      let activated = false;

      if (trialStarted) {
        // Trial starts same day, a bit later
        const trialHour = Math.min(regHour + 1 + Math.floor(rng.next() * 3), 23);
        trialStartDate = regDateStr;
        const trialTs = `${regDateStr}T${String(trialHour).padStart(2, "0")}:${String(Math.floor(rng.next() * 60)).padStart(2, "0")}:00Z`;

        ds.executeQuery(evInsert, [
          trialTs,
          "trial_start",
          uuid,
          null,
          JSON.stringify({ trial_days: variant.trialDays }),
        ]);

        // Activation (core feature usage during trial) — ~72% of trial starters
        activated = rng.next() < 0.72;

        // Conversion
        const convRate = config.baseConversionRate * variant.conversionMult;
        converted = rng.next() < convRate;

        if (converted) {
          const convDate = new Date(regDate);
          convDate.setDate(convDate.getDate() + variant.trialDays);
          conversionDate = convDate.toISOString().split("T")[0];
          const convTs = `${conversionDate}T10:00:00Z`;

          ds.executeQuery(evInsert, [
            convTs,
            "subscription_start",
            uuid,
            null,
            JSON.stringify({ plan: "monthly", price_mxn: 199 }),
          ]);

          // Retention
          const retRate = config.baseRetentionRate * variant.retentionMult;
          retained1month = rng.next() < retRate;

          // Revenue
          if (retained1month) {
            revenue30d = Math.max(0, rng.normal(config.baseRevenue, config.revenueStdDev));
          } else {
            revenue30d = Math.max(0, rng.normal(config.baseRevenue * 0.3, config.revenueStdDev * 0.5));

            // Churn event
            const churnDate = new Date(convDate);
            churnDate.setDate(churnDate.getDate() + 25 + Math.floor(rng.next() * 10));
            ds.executeQuery(evInsert, [
              churnDate.toISOString().split("T")[0] + "T12:00:00Z",
              "churn",
              uuid,
              null,
              null,
            ]);
          }

          // Payment event
          revenue30d = Math.round(revenue30d * 100) / 100;
          ds.executeQuery(evInsert, [
            convTs,
            "payment",
            uuid,
            revenue30d,
            null,
          ]);

          // Refund
          const refundRate = config.baseRefundRate + variant.refundDelta;
          refunded = rng.next() < refundRate;
          if (refunded) {
            const refundDate = new Date(convDate);
            refundDate.setDate(refundDate.getDate() + 2 + Math.floor(rng.next() * 5));
            ds.executeQuery(evInsert, [
              refundDate.toISOString().split("T")[0] + "T14:00:00Z",
              "refund",
              uuid,
              revenue30d,
              null,
            ]);
            revenue30d = 0;
          }
        }
      }

      // Support tickets (Poisson ~0.3, for all registrants)
      supportTickets = Math.floor(-Math.log(1 - rng.next()) * 0.3);
      for (let t = 0; t < supportTickets; t++) {
        const ticketDay = Math.floor(rng.next() * 30);
        const ticketDate = new Date(regDate);
        ticketDate.setDate(ticketDate.getDate() + ticketDay);
        ds.executeQuery(evInsert, [
          ticketDate.toISOString().split("T")[0] + "T09:00:00Z",
          "support_ticket",
          uuid,
          null,
          null,
        ]);
      }

      users.push({
        uuid,
        variant: variant.key,
        registrationDate: regDateStr,
        trialStarted,
        trialStartDate,
        trialDays: variant.trialDays,
        converted,
        conversionDate,
        revenue30d,
        retained1month,
        refunded,
        supportTickets,
        activated,
        source,
      });

      userId++;
    }
  }

  ds.executeQuery("COMMIT");

  return users;
}

// ---------------------------------------------------------------------------
// Metric aggregation
// ---------------------------------------------------------------------------

function aggregateAndInsertMetrics(
  ds: SqliteDataSource,
  users: UserRecord[],
  config: ExperimentConfig,
): void {
  const emInsert =
    "INSERT OR REPLACE INTO experiment_metrics (experiment_key, metric_key, variant_key, sample_size, mean, std_dev, successes) VALUES (?, ?, ?, ?, ?, ?, ?)";

  const variantKeys = config.variants.map((v) => v.key);

  for (const vk of variantKeys) {
    const vUsers = users.filter((u) => u.variant === vk);
    const trialStarters = vUsers.filter((u) => u.trialStarted);
    const converters = vUsers.filter((u) => u.converted);

    // ltv_30d — continuous, denominator = all registrants
    {
      const values = vUsers.map((u) => u.revenue30d);
      const { mean, stdDev } = stats(values);
      ds.executeQuery(emInsert, ["trial-length", "ltv_30d", vk, values.length, mean, stdDev, null]);
    }

    // trial_start_rate — binary, denominator = all registrants
    {
      const n = vUsers.length;
      const successes = trialStarters.length;
      const mean = n > 0 ? successes / n : 0;
      const stdDev = n > 1 ? Math.sqrt((mean * (1 - mean) * n) / (n - 1)) : 0;
      ds.executeQuery(emInsert, ["trial-length", "trial_start_rate", vk, n, mean, stdDev, successes]);
    }

    // conversion_rate — binary, denominator = trial starters
    {
      const n = trialStarters.length;
      const successes = converters.length;
      const mean = n > 0 ? successes / n : 0;
      const stdDev = n > 1 ? Math.sqrt((mean * (1 - mean) * n) / (n - 1)) : 0;
      ds.executeQuery(emInsert, ["trial-length", "conversion_rate", vk, n, mean, stdDev, successes]);
    }

    // retention_1month — binary, denominator = converters
    {
      const n = converters.length;
      const successes = converters.filter((u) => u.retained1month).length;
      const mean = n > 0 ? successes / n : 0;
      const stdDev = n > 1 ? Math.sqrt((mean * (1 - mean) * n) / (n - 1)) : 0;
      ds.executeQuery(emInsert, ["trial-length", "retention_1month", vk, n, mean, stdDev, successes]);
    }

    // refund_rate — binary, denominator = converters
    {
      const n = converters.length;
      const successes = converters.filter((u) => u.refunded).length;
      const mean = n > 0 ? successes / n : 0;
      const stdDev = n > 1 ? Math.sqrt((mean * (1 - mean) * n) / (n - 1)) : 0;
      ds.executeQuery(emInsert, ["trial-length", "refund_rate", vk, n, mean, stdDev, successes]);
    }

    // time_to_conversion — continuous, denominator = converters
    {
      const values = converters.map((u) => {
        const reg = new Date(u.registrationDate);
        const conv = new Date(u.conversionDate!);
        return (conv.getTime() - reg.getTime()) / (1000 * 60 * 60 * 24);
      });
      const { mean, stdDev } = stats(values);
      ds.executeQuery(emInsert, ["trial-length", "time_to_conversion", vk, values.length, mean, stdDev, null]);
    }

    // support_tickets_per_reg — continuous, denominator = all registrants
    {
      const values = vUsers.map((u) => u.supportTickets);
      const { mean, stdDev } = stats(values);
      ds.executeQuery(emInsert, ["trial-length", "support_tickets_per_reg", vk, values.length, mean, stdDev, null]);
    }

    // activation_rate — binary, denominator = trial starters
    {
      const n = trialStarters.length;
      const successes = trialStarters.filter((u) => u.activated).length;
      const mean = n > 0 ? successes / n : 0;
      const stdDev = n > 1 ? Math.sqrt((mean * (1 - mean) * n) / (n - 1)) : 0;
      ds.executeQuery(emInsert, ["trial-length", "activation_rate", vk, n, mean, stdDev, successes]);
    }
  }
}

function stats(values: number[]): { mean: number; stdDev: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, stdDev: Math.sqrt(variance) };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/sqlite-seed.ts") ||
    process.argv[1].endsWith("/sqlite-seed.js"));

if (isMain) {
  const dbPathIdx = process.argv.indexOf("--db-path");
  const dbPath =
    dbPathIdx !== -1 && process.argv[dbPathIdx + 1]
      ? process.argv[dbPathIdx + 1]
      : "./data/local.db";

  console.log(`Seeding database at: ${dbPath}`);
  const ds = seedDatabase(dbPath);
  ds.close();
  console.log("Seed complete.");
}
