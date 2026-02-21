import { normalCDF } from "./distributions.js";

export interface GuardrailInput {
  metric: string;
  controlStats: { mean: number; stdDev: number; n: number };
  treatmentStats: { mean: number; stdDev: number; n: number };
  /** The threshold for the guardrail (e.g., 0.05 for 5% relative, or 0.01 for 1pp absolute) */
  threshold: number;
  thresholdType: "relative" | "absolute";
  /** Direction of concern: "no_decrease" means we worry about treatment being lower */
  direction: "no_decrease" | "no_increase";
}

export type GuardrailStatus = "pass" | "fail" | "inconclusive";

export interface GuardrailResult {
  metric: string;
  status: GuardrailStatus;
  observedDiff: number;
  observedRelativeDiff: number | null;
  threshold: number;
  thresholdType: string;
  pValue: number;
  power: number;
  interpretation: string;
}

/**
 * Check a single guardrail metric.
 *
 * For "no_decrease" direction:
 *   PASS: confident that treatment is within threshold of control (treatment ≥ control - δ)
 *   FAIL: confident that treatment is below threshold (treatment < control - δ)
 *   INCONCLUSIVE: can't determine either way (underpowered)
 *
 * For "no_increase" direction:
 *   PASS: confident that treatment is within threshold (treatment ≤ control + δ)
 *   FAIL: confident that treatment exceeds threshold (treatment > control + δ)
 *   INCONCLUSIVE: can't determine either way
 */
function checkSingleGuardrail(input: GuardrailInput): GuardrailResult {
  const { metric, controlStats, treatmentStats, threshold, thresholdType, direction } = input;

  const diff = treatmentStats.mean - controlStats.mean;
  const relativeDiff = controlStats.mean !== 0
    ? diff / Math.abs(controlStats.mean)
    : null;

  // Compute the absolute threshold
  const absoluteThreshold = thresholdType === "relative"
    ? threshold * Math.abs(controlStats.mean)
    : threshold;

  // Standard error of the difference
  const se = Math.sqrt(
    (controlStats.stdDev ** 2) / controlStats.n +
    (treatmentStats.stdDev ** 2) / treatmentStats.n
  );

  if (se === 0) {
    // Zero variance — deterministic comparison
    let status: GuardrailStatus;
    if (direction === "no_decrease") {
      status = diff >= -absoluteThreshold ? "pass" : "fail";
    } else {
      status = diff <= absoluteThreshold ? "pass" : "fail";
    }
    return {
      metric, status, observedDiff: diff, observedRelativeDiff: relativeDiff,
      threshold, thresholdType, pValue: status === "pass" ? 0 : 1, power: 1,
      interpretation: `Zero variance. Guardrail ${status.toUpperCase()}: observed diff = ${diff.toFixed(4)}.`,
    };
  }

  // One-sided test
  let testStat: number;
  let pValueForPass: number;
  let pValueForFail: number;

  if (direction === "no_decrease") {
    // PASS test: H0: diff ≤ -δ, H1: diff > -δ (non-inferiority)
    testStat = (diff + absoluteThreshold) / se;
    pValueForPass = 1 - normalCDF(testStat);

    // FAIL test: H0: diff ≥ -δ, H1: diff < -δ (inferiority)
    pValueForFail = normalCDF(testStat);
  } else {
    // PASS test: H0: diff ≥ δ, H1: diff < δ (non-superiority)
    testStat = (diff - absoluteThreshold) / se;
    pValueForPass = normalCDF(testStat);

    // FAIL test: H0: diff ≤ δ, H1: diff > δ (exceeds threshold)
    pValueForFail = 1 - normalCDF(testStat);
  }

  // Compute power to detect a violation at the threshold boundary
  const power = computeGuardrailPower(
    controlStats, treatmentStats, absoluteThreshold, direction, 0.05
  );

  // Determine status
  const alpha = 0.05;
  let status: GuardrailStatus;
  let pValue: number;

  if (pValueForPass < alpha) {
    status = "pass";
    pValue = pValueForPass;
  } else if (pValueForFail < alpha) {
    status = "fail";
    pValue = pValueForFail;
  } else {
    status = "inconclusive";
    pValue = pValueForPass; // Report the non-inferiority p-value
  }

  const interpretation = buildGuardrailInterpretation(
    metric, status, diff, relativeDiff, absoluteThreshold, threshold,
    thresholdType, direction, pValue, power
  );

  return {
    metric, status, observedDiff: diff, observedRelativeDiff: relativeDiff,
    threshold, thresholdType, pValue, power, interpretation,
  };
}

/**
 * Compute power to detect a violation at the guardrail boundary.
 */
function computeGuardrailPower(
  controlStats: { stdDev: number; n: number },
  treatmentStats: { stdDev: number; n: number },
  absoluteThreshold: number,
  direction: "no_decrease" | "no_increase",
  alpha: number,
): number {
  const se = Math.sqrt(
    (controlStats.stdDev ** 2) / controlStats.n +
    (treatmentStats.stdDev ** 2) / treatmentStats.n
  );

  if (se === 0) return 1;

  // Critical value for one-sided test
  const zAlpha = inverseCriticalZ(alpha);

  // Under the alternative (true diff = -δ for no_decrease or +δ for no_increase),
  // what's the probability of rejecting H0?
  // Power = P(reject H0 | true diff = boundary)
  // For no_decrease: reject when (diff + δ)/se > z_α
  // Under true diff = -δ: power = P((X + δ)/se > z_α | X ~ N(-δ, se²))
  //                              = P(Z > z_α - 0/se) = P(Z > z_α) = α (at boundary)
  // That's trivial, so compute power at a detectable shift (e.g., 1.5× threshold)
  const trueEffect = 1.5 * absoluteThreshold;
  const noncentrality = trueEffect / se;

  if (direction === "no_decrease") {
    // Power = P((diff + δ)/se > z_α | true diff = -1.5δ)
    // = P(Z > z_α - (δ - 1.5δ)/se) = P(Z > z_α + 0.5δ/se)
    return 1 - normalCDF(zAlpha - noncentrality + absoluteThreshold / se);
  } else {
    return 1 - normalCDF(zAlpha - noncentrality + absoluteThreshold / se);
  }
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
 * Check multiple guardrail metrics at once.
 */
export function checkGuardrails(inputs: GuardrailInput[]): GuardrailResult[] {
  return inputs.map(checkSingleGuardrail);
}

function buildGuardrailInterpretation(
  metric: string,
  status: GuardrailStatus,
  diff: number,
  relativeDiff: number | null,
  absoluteThreshold: number,
  threshold: number,
  thresholdType: string,
  direction: string,
  pValue: number,
  power: number,
): string {
  const diffStr = relativeDiff !== null
    ? `${diff.toFixed(4)} (${(relativeDiff * 100).toFixed(2)}% relative)`
    : diff.toFixed(4);

  const thresholdStr = thresholdType === "relative"
    ? `${(threshold * 100).toFixed(1)}% relative (${absoluteThreshold.toFixed(4)} absolute)`
    : `${absoluteThreshold.toFixed(4)} absolute`;

  const dirStr = direction === "no_decrease" ? "decrease" : "increase";

  switch (status) {
    case "pass":
      return (
        `Guardrail PASS for "${metric}": observed ${dirStr} of ${diffStr} ` +
        `is within the ${thresholdStr} threshold (p=${pValue.toFixed(4)}). ` +
        `Power=${(power * 100).toFixed(0)}%.`
      );
    case "fail":
      return (
        `Guardrail FAIL for "${metric}": observed ${dirStr} of ${diffStr} ` +
        `exceeds the ${thresholdStr} threshold (p=${pValue.toFixed(4)}). ` +
        `This guardrail violation is statistically significant.`
      );
    case "inconclusive":
      return (
        `Guardrail INCONCLUSIVE for "${metric}": observed ${dirStr} of ${diffStr}. ` +
        `Cannot confidently determine if within ${thresholdStr} threshold (p=${pValue.toFixed(4)}). ` +
        `Power=${(power * 100).toFixed(0)}% — ${power < 0.8 ? "sample may be too small for this guardrail." : "sample size is adequate."}`
      );
  }
}
