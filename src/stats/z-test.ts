import { normalCDF } from "./distributions.js";
import type { ZTestInput, StatisticalTestResult, Alternative } from "./types.js";

/**
 * Two-proportion z-test for comparing binary outcome rates
 * between treatment and control groups.
 */
export function twoProportionZTest(input: ZTestInput): StatisticalTestResult {
  const { control, treatment } = input;
  const alpha = input.alpha ?? 0.05;
  const alternative = input.alternative ?? "two-sided";

  const { successes: x1, n: n1 } = treatment;
  const { successes: x2, n: n2 } = control;

  if (n1 < 1 || n2 < 1) {
    throw new Error("Each group must have at least 1 observation");
  }

  const p1 = x1 / n1;
  const p2 = x2 / n2;

  // Pooled proportion under H₀
  const pPool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));

  if (se === 0) {
    return {
      testName: "Two-Proportion z-Test",
      testStatistic: 0,
      pValue: 1,
      confidenceInterval: { lower: 0, upper: 0, level: 1 - alpha },
      effectSize: 0,
      relativeEffectSize: p2 !== 0 ? 0 : null,
      significant: false,
      alpha,
      interpretation:
        "Both groups have zero variance (all successes or all failures); no difference can be detected.",
    };
  }

  const zStat = (p1 - p2) / se;

  // p-value
  let pValue: number;
  if (alternative === "two-sided") {
    pValue = 2 * (1 - normalCDF(Math.abs(zStat)));
  } else if (alternative === "greater") {
    pValue = 1 - normalCDF(zStat);
  } else {
    pValue = normalCDF(zStat);
  }

  // Confidence interval using unpooled SE (more standard for CI)
  const seUnpooled = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const criticalZ = getCriticalZ(alpha, alternative);
  const diff = p1 - p2;

  let ciLower: number;
  let ciUpper: number;

  if (alternative === "two-sided") {
    ciLower = diff - criticalZ * seUnpooled;
    ciUpper = diff + criticalZ * seUnpooled;
  } else if (alternative === "greater") {
    ciLower = diff - criticalZ * seUnpooled;
    ciUpper = Infinity;
  } else {
    ciLower = -Infinity;
    ciUpper = diff + criticalZ * seUnpooled;
  }

  const effectSize = diff;
  const relativeEffectSize = p2 !== 0 ? diff / Math.abs(p2) : null;

  const significant = pValue < alpha;
  const interpretation = buildInterpretation(
    zStat,
    pValue,
    p1,
    p2,
    diff,
    relativeEffectSize,
    significant,
    alpha,
    alternative
  );

  return {
    testName: "Two-Proportion z-Test",
    testStatistic: zStat,
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
 * Critical z-value via bisection on normalCDF.
 */
function getCriticalZ(alpha: number, alternative: Alternative): number {
  const tailAlpha = alternative === "two-sided" ? alpha / 2 : alpha;
  const target = 1 - tailAlpha;

  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (normalCDF(mid) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function buildInterpretation(
  zStat: number,
  pValue: number,
  p1: number,
  p2: number,
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
      `The treatment proportion (${(p1 * 100).toFixed(2)}%) is statistically significantly ${direction} ` +
      `than the control (${(p2 * 100).toFixed(2)}%) ` +
      `(z=${zStat.toFixed(4)}, p=${pValue.toFixed(6)}, α=${alpha}). ` +
      `The observed difference is ${(diff * 100).toFixed(2)}pp${relStr}.`
    );
  } else {
    return (
      `No statistically significant difference was detected between treatment (${(p1 * 100).toFixed(2)}%) ` +
      `and control (${(p2 * 100).toFixed(2)}%) ` +
      `(z=${zStat.toFixed(4)}, p=${pValue.toFixed(6)}, α=${alpha}). ` +
      `The observed difference is ${(diff * 100).toFixed(2)}pp${relStr}.`
    );
  }
}
