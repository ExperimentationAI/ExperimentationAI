import { tCDF, normalCDF } from "./distributions.js";
import type { TTestInput, StatisticalTestResult, Alternative } from "./types.js";

/**
 * Welch's two-sample t-test for comparing means of two independent groups
 * with potentially unequal variances and sample sizes.
 */
export function twoSampleTTest(input: TTestInput): StatisticalTestResult {
  const { control, treatment } = input;
  const alpha = input.alpha ?? 0.05;
  const alternative = input.alternative ?? "two-sided";

  const { mean: m1, stdDev: s1, n: n1 } = treatment;
  const { mean: m2, stdDev: s2, n: n2 } = control;

  if (n1 < 2 || n2 < 2) {
    throw new Error("Each group must have at least 2 observations");
  }

  // Welch's t-statistic
  const se1 = (s1 * s1) / n1;
  const se2 = (s2 * s2) / n2;
  const se = Math.sqrt(se1 + se2);

  if (se === 0) {
    return {
      testName: "Welch's Two-Sample t-Test",
      testStatistic: 0,
      pValue: 1,
      confidenceInterval: { lower: 0, upper: 0, level: 1 - alpha },
      effectSize: 0,
      relativeEffectSize: m2 !== 0 ? 0 : null,
      significant: false,
      alpha,
      interpretation:
        "Both groups have zero variance; no difference can be detected.",
    };
  }

  const tStat = (m1 - m2) / se;

  // Welch-Satterthwaite degrees of freedom
  const df =
    (se1 + se2) ** 2 /
    (se1 ** 2 / (n1 - 1) + se2 ** 2 / (n2 - 1));

  // p-value based on alternative hypothesis
  let pValue: number;
  if (alternative === "two-sided") {
    pValue = 2 * (1 - tCDF(Math.abs(tStat), df));
  } else if (alternative === "greater") {
    pValue = 1 - tCDF(tStat, df);
  } else {
    pValue = tCDF(tStat, df);
  }

  // Confidence interval for the difference in means
  // For two-sided, use t_{α/2, df}; approximate with normal for large df
  const criticalZ = getCriticalValue(alpha, alternative, df);
  const diff = m1 - m2;
  let ciLower: number;
  let ciUpper: number;

  if (alternative === "two-sided") {
    ciLower = diff - criticalZ * se;
    ciUpper = diff + criticalZ * se;
  } else if (alternative === "greater") {
    ciLower = diff - criticalZ * se;
    ciUpper = Infinity;
  } else {
    ciLower = -Infinity;
    ciUpper = diff + criticalZ * se;
  }

  // Effect sizes
  const effectSize = diff;
  const relativeEffectSize = m2 !== 0 ? diff / Math.abs(m2) : null;

  const significant = pValue < alpha;
  const interpretation = buildInterpretation(
    tStat,
    pValue,
    df,
    diff,
    relativeEffectSize,
    significant,
    alpha,
    alternative
  );

  return {
    testName: "Welch's Two-Sample t-Test",
    testStatistic: tStat,
    pValue,
    confidenceInterval: { lower: ciLower, upper: ciUpper, level: 1 - alpha },
    effectSize,
    relativeEffectSize,
    significant,
    alpha,
    interpretation,
  };
}

/**
 * Approximate critical value from t-distribution.
 * For large df, use normal approximation; otherwise do a simple bisection on tCDF.
 */
function getCriticalValue(
  alpha: number,
  alternative: Alternative,
  df: number
): number {
  const tailAlpha = alternative === "two-sided" ? alpha / 2 : alpha;

  // Bisection search for t such that P(T > t) = tailAlpha
  // i.e., tCDF(t, df) = 1 - tailAlpha
  const target = 1 - tailAlpha;
  let lo = 0;
  let hi = 10;

  // Expand upper bound if needed
  while (tCDF(hi, df) < target) {
    hi *= 2;
  }

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

function buildInterpretation(
  tStat: number,
  pValue: number,
  df: number,
  diff: number,
  relativeEffect: number | null,
  significant: boolean,
  alpha: number,
  alternative: Alternative
): string {
  const direction = diff > 0 ? "higher" : diff < 0 ? "lower" : "equal to";
  const relStr =
    relativeEffect !== null
      ? ` (${(relativeEffect * 100).toFixed(2)}% relative change)`
      : "";

  if (significant) {
    return (
      `The treatment mean is statistically significantly ${direction} than the control ` +
      `(t=${tStat.toFixed(4)}, df=${df.toFixed(1)}, p=${pValue.toFixed(6)}, α=${alpha}). ` +
      `The observed difference is ${diff.toFixed(4)}${relStr}.`
    );
  } else {
    return (
      `No statistically significant difference was detected between treatment and control ` +
      `(t=${tStat.toFixed(4)}, df=${df.toFixed(1)}, p=${pValue.toFixed(6)}, α=${alpha}). ` +
      `The observed difference is ${diff.toFixed(4)}${relStr}.`
    );
  }
}
