import { normalCDF } from "./distributions.js";

export interface FunnelVariant {
  key: string;
  /** counts[i] = number of users reaching stage i. Must be non-increasing. */
  counts: number[];
}

export interface FunnelInput {
  stages: string[];
  variants: FunnelVariant[];
}

export interface StageRate {
  stage: string;
  count: number;
  rate: number;
  ci: { lower: number; upper: number };
}

export interface StageComparison {
  stage: string;
  variantKey: string;
  controlKey: string;
  variantRate: number;
  controlRate: number;
  diff: number;
  relativeDiff: number | null;
  pValue: number;
  significant: boolean;
}

export interface VariantFunnel {
  key: string;
  stages: StageRate[];
  endToEndRate: number;
  endToEndCI: { lower: number; upper: number };
}

export interface FunnelResult {
  variants: VariantFunnel[];
  comparisons: StageComparison[];
  bottleneck: string | null;
  interpretation: string;
}

/**
 * Wilson score interval for a proportion.
 * Better coverage than Wald interval, especially for extreme proportions.
 */
function wilsonCI(
  successes: number,
  n: number,
  alpha: number = 0.05,
): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 0 };

  const z = inverseCriticalZ(alpha / 2);
  const pHat = successes / n;
  const denom = 1 + z * z / n;
  const center = (pHat + z * z / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt(pHat * (1 - pHat) / n + z * z / (4 * n * n));

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

function inverseCriticalZ(alpha: number): number {
  const target = 1 - alpha;
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (normalCDF(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Analyze a conversion funnel across multiple variants.
 *
 * Computes stage-by-stage conversion rates with Wilson CIs,
 * compares each stage across variants using z-tests,
 * and identifies which stage drives the overall difference.
 */
export function analyzeFunnel(input: FunnelInput): FunnelResult {
  const { stages, variants } = input;

  if (stages.length < 2) {
    throw new Error("Funnel must have at least 2 stages");
  }
  if (variants.length < 2) {
    throw new Error("Need at least 2 variants to compare");
  }

  for (const v of variants) {
    if (v.counts.length !== stages.length) {
      throw new Error(
        `Variant "${v.key}" has ${v.counts.length} counts but ${stages.length} stages`
      );
    }
  }

  // Compute per-variant funnel data
  const variantFunnels: VariantFunnel[] = variants.map((v) => {
    const stageRates: StageRate[] = [];

    for (let i = 0; i < stages.length; i++) {
      if (i === 0) {
        // First stage: rate = count / count (100%)
        stageRates.push({
          stage: stages[i],
          count: v.counts[i],
          rate: 1.0,
          ci: { lower: 1.0, upper: 1.0 },
        });
      } else {
        const prev = v.counts[i - 1];
        const curr = v.counts[i];
        const rate = prev > 0 ? curr / prev : 0;
        const ci = prev > 0 ? wilsonCI(curr, prev) : { lower: 0, upper: 0 };

        stageRates.push({
          stage: stages[i],
          count: curr,
          rate,
          ci,
        });
      }
    }

    // End-to-end rate
    const first = v.counts[0];
    const last = v.counts[v.counts.length - 1];
    const endToEndRate = first > 0 ? last / first : 0;
    const endToEndCI = first > 0 ? wilsonCI(last, first) : { lower: 0, upper: 0 };

    return { key: v.key, stages: stageRates, endToEndRate, endToEndCI };
  });

  // Cross-variant comparisons: first variant is control, rest are challengers
  const controlVariant = variants[0];
  const comparisons: StageComparison[] = [];

  let biggestAbsDiff = 0;
  let bottleneckStage: string | null = null;

  for (let i = 1; i < stages.length; i++) {
    const controlPrev = controlVariant.counts[i - 1];
    const controlCurr = controlVariant.counts[i];
    const controlRate = controlPrev > 0 ? controlCurr / controlPrev : 0;

    for (let v = 1; v < variants.length; v++) {
      const variant = variants[v];
      const varPrev = variant.counts[i - 1];
      const varCurr = variant.counts[i];
      const varRate = varPrev > 0 ? varCurr / varPrev : 0;

      const diff = varRate - controlRate;
      const relativeDiff = controlRate !== 0 ? diff / controlRate : null;

      // Two-proportion z-test for this stage
      const pPool = (controlCurr + varCurr) / (controlPrev + varPrev || 1);
      const se = Math.sqrt(pPool * (1 - pPool) * (1 / (controlPrev || 1) + 1 / (varPrev || 1)));
      const zStat = se > 0 ? diff / se : 0;
      const pValue = se > 0 ? 2 * (1 - normalCDF(Math.abs(zStat))) : 1;

      comparisons.push({
        stage: stages[i],
        variantKey: variant.key,
        controlKey: controlVariant.key,
        variantRate: varRate,
        controlRate,
        diff,
        relativeDiff,
        pValue,
        significant: pValue < 0.05,
      });

      // Track bottleneck: stage with largest absolute control-challenger difference
      if (Math.abs(diff) > biggestAbsDiff) {
        biggestAbsDiff = Math.abs(diff);
        bottleneckStage = stages[i];
      }
    }
  }

  const interpretation = buildFunnelInterpretation(variantFunnels, comparisons, bottleneckStage);

  return {
    variants: variantFunnels,
    comparisons,
    bottleneck: bottleneckStage,
    interpretation,
  };
}

function buildFunnelInterpretation(
  variants: VariantFunnel[],
  comparisons: StageComparison[],
  bottleneck: string | null,
): string {
  const parts: string[] = [];

  // End-to-end summary
  parts.push("End-to-end conversion rates:");
  for (const v of variants) {
    parts.push(
      `  ${v.key}: ${(v.endToEndRate * 100).toFixed(2)}% ` +
      `[${(v.endToEndCI.lower * 100).toFixed(2)}%, ${(v.endToEndCI.upper * 100).toFixed(2)}%]`
    );
  }

  // Significant stage differences
  const sigComps = comparisons.filter((c) => c.significant);
  if (sigComps.length > 0) {
    parts.push("");
    parts.push("Significant stage differences:");
    for (const c of sigComps) {
      const dir = c.diff > 0 ? "higher" : "lower";
      parts.push(
        `  ${c.stage}: ${c.variantKey} is ${(Math.abs(c.diff) * 100).toFixed(2)}pp ${dir} ` +
        `than ${c.controlKey} (p=${c.pValue.toFixed(4)})`
      );
    }
  }

  if (bottleneck) {
    parts.push("");
    parts.push(`Bottleneck stage: "${bottleneck}" shows the largest cross-variant difference.`);
  }

  return parts.join("\n");
}
