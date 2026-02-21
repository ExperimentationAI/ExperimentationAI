import { normalCDF, tCDF } from "./distributions.js";

export interface NonInferiorityInput {
  control: { mean: number; stdDev: number; n: number };
  treatment: { mean: number; stdDev: number; n: number };
  /** Non-inferiority margin δ as a fraction of control mean (e.g., 0.10 = 10% relative) */
  margin: number;
  /** Whether margin is relative to control mean or absolute */
  marginType?: "relative" | "absolute";
  metricType?: "continuous" | "binary";
  alpha?: number;
}

export interface NonInferiorityResult {
  nonInferior: boolean;
  margin: number;
  absoluteMargin: number;
  observedDiff: number;
  pValue: number;
  ci: { lower: number; upper: number };
  testStatistic: number;
  interpretation: string;
}

/**
 * Non-inferiority test.
 *
 * H0: μ_treatment - μ_control ≤ -δ  (treatment is inferior by more than δ)
 * H1: μ_treatment - μ_control > -δ   (treatment is non-inferior)
 *
 * Reject H0 → treatment is non-inferior (PASS).
 *
 * For continuous metrics: one-sided Welch's t-test shifted by margin.
 * For binary metrics: one-sided z-test shifted by margin.
 */
export function nonInferiorityTest(input: NonInferiorityInput): NonInferiorityResult {
  const { control, treatment } = input;
  const alpha = input.alpha ?? 0.10;
  const marginType = input.marginType ?? "relative";
  const metricType = input.metricType ?? "continuous";

  if (control.n < 2 || treatment.n < 2) {
    throw new Error("Each group must have at least 2 observations");
  }

  // Compute absolute margin δ
  const absoluteMargin = marginType === "relative"
    ? input.margin * Math.abs(control.mean)
    : input.margin;

  const diff = treatment.mean - control.mean;

  let se: number;
  let testStat: number;
  let pValue: number;
  let ciLower: number;
  let ciUpper: number;

  if (metricType === "binary") {
    // For binary metrics, use proportions
    const p1 = treatment.mean;
    const p2 = control.mean;
    se = Math.sqrt(
      (p1 * (1 - p1)) / treatment.n + (p2 * (1 - p2)) / control.n
    );

    if (se === 0) {
      return zeroVarianceResult(diff, absoluteMargin, input.margin, alpha);
    }

    // Test statistic: shift by margin
    // H0: diff ≤ -δ, so test stat = (diff - (-δ)) / se = (diff + δ) / se
    testStat = (diff + absoluteMargin) / se;
    pValue = 1 - normalCDF(testStat);

    // One-sided CI: lower bound only
    const zCrit = inverseCriticalZ(alpha);
    ciLower = diff - zCrit * se;
    ciUpper = Infinity;
  } else {
    // Continuous: Welch's t-test shifted by margin
    const se1 = (treatment.stdDev ** 2) / treatment.n;
    const se2 = (control.stdDev ** 2) / control.n;
    se = Math.sqrt(se1 + se2);

    if (se === 0) {
      return zeroVarianceResult(diff, absoluteMargin, input.margin, alpha);
    }

    // Welch-Satterthwaite df
    const df = (se1 + se2) ** 2 / (se1 ** 2 / (treatment.n - 1) + se2 ** 2 / (control.n - 1));

    // H0: diff ≤ -δ → test stat = (diff + δ) / se
    testStat = (diff + absoluteMargin) / se;
    pValue = 1 - tCDF(testStat, df);

    // One-sided CI lower bound using t critical value
    const tCrit = inverseCriticalT(alpha, df);
    ciLower = diff - tCrit * se;
    ciUpper = Infinity;
  }

  const nonInferior = pValue < alpha;

  const interpretation = buildNonInferiorityInterpretation(
    nonInferior, diff, absoluteMargin, input.margin, marginType,
    pValue, alpha, control.mean
  );

  return {
    nonInferior,
    margin: input.margin,
    absoluteMargin,
    observedDiff: diff,
    pValue,
    ci: { lower: ciLower, upper: ciUpper },
    testStatistic: testStat,
    interpretation,
  };
}

function zeroVarianceResult(
  diff: number, absoluteMargin: number, margin: number, alpha: number
): NonInferiorityResult {
  const nonInferior = diff > -absoluteMargin;
  return {
    nonInferior,
    margin,
    absoluteMargin,
    observedDiff: diff,
    pValue: nonInferior ? 0 : 1,
    ci: { lower: diff, upper: Infinity },
    testStatistic: 0,
    interpretation: nonInferior
      ? "Zero variance in both groups. Treatment is trivially non-inferior."
      : "Zero variance in both groups. Treatment is inferior.",
  };
}

/**
 * Inverse normal CDF via bisection: find z such that P(Z > z) = alpha, i.e. Φ(z) = 1 - alpha.
 */
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
 * Inverse t CDF via bisection: find t such that tCDF(t, df) = 1 - alpha.
 */
function inverseCriticalT(alpha: number, df: number): number {
  const target = 1 - alpha;
  let lo = 0;
  let hi = 10;
  while (tCDF(hi, df) < target) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function buildNonInferiorityInterpretation(
  nonInferior: boolean,
  diff: number,
  absoluteMargin: number,
  margin: number,
  marginType: string,
  pValue: number,
  alpha: number,
  controlMean: number,
): string {
  const marginDesc = marginType === "relative"
    ? `${(margin * 100).toFixed(1)}% relative (${absoluteMargin.toFixed(4)} absolute)`
    : `${absoluteMargin.toFixed(4)} absolute`;

  const relChange = controlMean !== 0
    ? ` (${((diff / Math.abs(controlMean)) * 100).toFixed(2)}% relative)`
    : "";

  if (nonInferior) {
    return (
      `Non-inferiority ESTABLISHED (p=${pValue.toFixed(6)}, α=${alpha}). ` +
      `The treatment difference of ${diff.toFixed(4)}${relChange} is within the ` +
      `non-inferiority margin of ${marginDesc}. ` +
      `We can conclude the treatment is not meaningfully worse than control.`
    );
  } else {
    return (
      `Non-inferiority NOT established (p=${pValue.toFixed(6)}, α=${alpha}). ` +
      `The treatment difference of ${diff.toFixed(4)}${relChange} could not be shown to be within ` +
      `the non-inferiority margin of ${marginDesc}. ` +
      `Insufficient evidence to conclude treatment is not worse than control.`
    );
  }
}
