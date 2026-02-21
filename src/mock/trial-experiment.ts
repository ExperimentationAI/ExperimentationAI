/**
 * Mock data generator for a 3-arm trial length optimization experiment.
 *
 * Generates ~98,685 user records across 3 variants (20/40/40 split):
 *   - control: 14-day free trial
 *   - short_trial: 3-day free trial
 *   - medium_trial: 7-day free trial
 *
 * Baseline rates (from experiment brief):
 *   - Registration → Trial Start: 17%
 *   - Trial → Paid: 42%
 *   - 1-month retention: 64%
 *   - Refund rate: 3%
 */

export interface MockUser {
  userId: string;
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
}

export interface VariantConfig {
  key: string;
  trialDays: number;
  allocationWeight: number;
  /** Relative adjustment to trial start rate vs baseline */
  trialStartMult: number;
  /** Relative adjustment to trial→paid rate vs baseline */
  conversionMult: number;
  /** Relative adjustment to retention vs baseline */
  retentionMult: number;
  /** Absolute adjustment to refund rate */
  refundDelta: number;
}

export interface ExperimentConfig {
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
  seed?: number;
}

/**
 * Default configuration matching the experiment brief.
 */
export const DEFAULT_CONFIG: ExperimentConfig = {
  startDate: "2026-01-15",
  durationDays: 45,
  dailyRegistrants: 2193, // ~98,685 total
  baseTrialStartRate: 0.17,
  baseConversionRate: 0.42,
  baseRetentionRate: 0.64,
  baseRefundRate: 0.03,
  baseRevenue: 450, // MXN 30-day revenue for retained users
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
      trialStartMult: 0.95,   // 5% lower trial start (urgency friction)
      conversionMult: 1.15,   // 15% higher trial→paid (urgency effect)
      retentionMult: 0.97,    // 3% lower retention (less time to evaluate)
      refundDelta: 0.005,     // 0.5pp more refunds
    },
    {
      key: "medium_trial",
      trialDays: 7,
      allocationWeight: 0.40,
      trialStartMult: 0.98,   // 2% lower trial start
      conversionMult: 1.08,   // 8% higher trial→paid
      retentionMult: 0.99,    // 1% lower retention
      refundDelta: 0.002,     // 0.2pp more refunds
    },
  ],
  seed: 42,
};

/**
 * Simple seeded PRNG (mulberry32).
 */
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

/**
 * Generate mock experiment data.
 */
export function generateTrialExperiment(
  config: ExperimentConfig = DEFAULT_CONFIG,
): MockUser[] {
  const rng = new SeededRandom(config.seed ?? 42);
  const users: MockUser[] = [];
  let userId = 1;

  const startDate = new Date(config.startDate);

  for (let day = 0; day < config.durationDays; day++) {
    const regDate = new Date(startDate);
    regDate.setDate(regDate.getDate() + day);
    const regDateStr = regDate.toISOString().split("T")[0];

    for (let i = 0; i < config.dailyRegistrants; i++) {
      // Assign variant based on allocation weights
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

      // Trial start
      const trialStartRate = config.baseTrialStartRate * variant.trialStartMult;
      const trialStarted = rng.next() < trialStartRate;

      let trialStartDate: string | null = null;
      let converted = false;
      let conversionDate: string | null = null;
      let revenue30d = 0;
      let retained1month = false;
      let refunded = false;
      let supportTickets = 0;

      if (trialStarted) {
        // Trial starts same day as registration
        trialStartDate = regDateStr;

        // Conversion (trial → paid)
        const convRate = config.baseConversionRate * variant.conversionMult;
        converted = rng.next() < convRate;

        if (converted) {
          // Conversion happens after trial period
          const convDate = new Date(regDate);
          convDate.setDate(convDate.getDate() + variant.trialDays);
          conversionDate = convDate.toISOString().split("T")[0];

          // Retention
          const retRate = config.baseRetentionRate * variant.retentionMult;
          retained1month = rng.next() < retRate;

          // Revenue (only for converted users)
          if (retained1month) {
            revenue30d = Math.max(0, rng.normal(config.baseRevenue, config.revenueStdDev));
          } else {
            // Churned users have partial revenue
            revenue30d = Math.max(0, rng.normal(config.baseRevenue * 0.3, config.revenueStdDev * 0.5));
          }

          // Refunds
          const refundRate = config.baseRefundRate + variant.refundDelta;
          refunded = rng.next() < refundRate;
          if (refunded) {
            revenue30d = 0;
          }

          // Support tickets (Poisson-ish)
          supportTickets = Math.floor(-Math.log(1 - rng.next()) * 0.3);
        }
      }

      users.push({
        userId: `user-${String(userId).padStart(6, "0")}`,
        variant: variant.key,
        registrationDate: regDateStr,
        trialStarted,
        trialStartDate,
        trialDays: variant.trialDays,
        converted,
        conversionDate,
        revenue30d: Math.round(revenue30d * 100) / 100,
        retained1month,
        refunded,
        supportTickets,
      });

      userId++;
    }
  }

  return users;
}

/**
 * Compute summary statistics from mock data for a given metric.
 */
export function summarizeByVariant(
  users: MockUser[],
  metricFn: (u: MockUser) => number | boolean,
  filterFn?: (u: MockUser) => boolean,
): Map<string, { n: number; mean: number; stdDev: number; successes: number }> {
  const filtered = filterFn ? users.filter(filterFn) : users;
  const groups = new Map<string, number[]>();

  for (const user of filtered) {
    const val = metricFn(user);
    const numVal = typeof val === "boolean" ? (val ? 1 : 0) : val;
    if (!groups.has(user.variant)) groups.set(user.variant, []);
    groups.get(user.variant)!.push(numVal);
  }

  const result = new Map<string, { n: number; mean: number; stdDev: number; successes: number }>();

  for (const [key, values] of groups) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1 || 1);
    const stdDev = Math.sqrt(variance);
    const successes = values.filter((v) => v > 0).length;

    result.set(key, { n, mean, stdDev, successes });
  }

  return result;
}
