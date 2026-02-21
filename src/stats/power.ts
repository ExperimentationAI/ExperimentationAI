import { normalCDF } from "./distributions.js";

export interface PowerInput {
  /** Baseline rate (for binary) or baseline mean (for continuous) */
  baseline: number;
  /** Minimum detectable effect: absolute difference for continuous, relative for binary */
  mde: number;
  alpha?: number;
  /** Desired power (e.g., 0.80) */
  power?: number;
  /** Allocation ratios across variants (e.g., [0.2, 0.4, 0.4] for 20/40/40) */
  allocationRatios?: number[];
  metricType?: "continuous" | "binary";
  /** Baseline standard deviation (required for continuous metrics) */
  baselineStdDev?: number;
  /** Current sample sizes per variant (if checking mid-flight power) */
  currentN?: number[];
}

export interface PowerResult {
  requiredNPerVariant: number[];
  totalRequired: number;
  currentPower: number | null;
  currentN: number[] | null;
  daysRemaining: number | null;
  interpretation: string;
}

/**
 * Calculate sample size requirements and/or current power for an experiment.
 *
 * For binary metrics: uses the two-proportion z-test formula.
 * For continuous metrics: uses the two-sample t-test formula.
 *
 * Supports unequal allocation ratios (e.g., 20/40/40 split).
 */
export function calculatePower(input: PowerInput): PowerResult {
  const alpha = input.alpha ?? 0.05;
  const desiredPower = input.power ?? 0.80;
  const metricType = input.metricType ?? "binary";
  const allocationRatios = input.allocationRatios ?? [0.5, 0.5];

  // Validate allocation ratios sum to ~1
  const ratioSum = allocationRatios.reduce((a, b) => a + b, 0);
  if (Math.abs(ratioSum - 1.0) > 0.01) {
    throw new Error(`Allocation ratios must sum to 1.0, got ${ratioSum}`);
  }

  const zAlpha = inverseCriticalZ(alpha / 2); // Two-sided
  const zBeta = inverseCriticalZ(1 - desiredPower);

  let requiredNPerVariant: number[];

  if (metricType === "binary") {
    const p1 = input.baseline;
    const p2 = p1 + input.mde * p1; // mde is relative for binary
    const pBar = (p1 + p2) / 2;

    // Base sample size for equal allocation (per-arm)
    const nBase =
      ((zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2) /
      ((p2 - p1) ** 2);

    // Adjust for unequal allocation
    // The control arm needs n/r_control, treatment arms need n/r_treatment
    // Scale so that the smallest arm determines power
    const controlRatio = allocationRatios[0];
    requiredNPerVariant = allocationRatios.map((ratio) => {
      // Scale relative to equal allocation baseline
      const scaleFactor = 0.5 / ratio; // How much larger this arm needs to be vs equal split
      // For unequal allocation, we need to inflate by the variance factor
      const varianceInflation = (1 / controlRatio + 1 / ratio) / (1 / 0.5 + 1 / 0.5);
      return Math.ceil(nBase * varianceInflation * ratio * 2);
    });
  } else {
    // Continuous metrics
    const sigma = input.baselineStdDev ?? input.baseline * 0.5; // Default: CV=0.5
    const delta = input.mde; // Absolute difference for continuous

    if (delta === 0) {
      throw new Error("MDE must be non-zero");
    }

    // Base per-arm sample size for equal allocation
    const nBase = ((zAlpha + zBeta) ** 2 * 2 * sigma ** 2) / (delta ** 2);

    requiredNPerVariant = allocationRatios.map((ratio) => {
      const varianceInflation = (1 / allocationRatios[0] + 1 / ratio) / (1 / 0.5 + 1 / 0.5);
      return Math.ceil(nBase * varianceInflation * ratio * 2);
    });
  }

  const totalRequired = requiredNPerVariant.reduce((a, b) => a + b, 0);

  // Compute current power if currentN is provided
  let currentPower: number | null = null;
  let daysRemaining: number | null = null;

  if (input.currentN) {
    currentPower = computeCurrentPower(
      input, input.currentN, alpha, metricType
    );
  }

  const interpretation = buildPowerInterpretation(
    requiredNPerVariant, totalRequired, currentPower, input.currentN ?? null,
    desiredPower, alpha, input.mde, metricType
  );

  return {
    requiredNPerVariant,
    totalRequired,
    currentPower,
    currentN: input.currentN ?? null,
    daysRemaining,
    interpretation,
  };
}

function computeCurrentPower(
  input: PowerInput,
  currentN: number[],
  alpha: number,
  metricType: string,
): number {
  const zAlpha = inverseCriticalZ(alpha / 2);
  const controlN = currentN[0];

  // Use the smallest pairwise comparison for power
  let minPower = 1;

  for (let i = 1; i < currentN.length; i++) {
    const treatmentN = currentN[i];

    let delta: number;
    let se: number;

    if (metricType === "binary") {
      const p1 = input.baseline;
      const p2 = p1 + input.mde * p1;
      delta = Math.abs(p2 - p1);
      se = Math.sqrt(p1 * (1 - p1) / controlN + p2 * (1 - p2) / treatmentN);
    } else {
      const sigma = input.baselineStdDev ?? input.baseline * 0.5;
      delta = Math.abs(input.mde);
      se = sigma * Math.sqrt(1 / controlN + 1 / treatmentN);
    }

    if (se === 0) {
      minPower = Math.min(minPower, 1);
      continue;
    }

    // Power = P(|Z| > z_α | true effect = delta)
    // = 1 - Φ(z_α - delta/se) + Φ(-z_α - delta/se)
    // ≈ 1 - Φ(z_α - delta/se)  (second term negligible)
    const noncentrality = delta / se;
    const power = 1 - normalCDF(zAlpha - noncentrality);
    minPower = Math.min(minPower, power);
  }

  return minPower;
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

function buildPowerInterpretation(
  requiredNPerVariant: number[],
  totalRequired: number,
  currentPower: number | null,
  currentN: number[] | null,
  desiredPower: number,
  alpha: number,
  mde: number,
  metricType: string,
): string {
  const parts: string[] = [];

  parts.push(
    `Sample size calculation (α=${alpha}, power=${(desiredPower * 100).toFixed(0)}%, ` +
    `MDE=${metricType === "binary" ? (mde * 100).toFixed(1) + "% relative" : mde.toFixed(4) + " absolute"}):`
  );

  parts.push(`  Required per variant: [${requiredNPerVariant.join(", ")}]`);
  parts.push(`  Total required: ${totalRequired}`);

  if (currentPower !== null && currentN !== null) {
    const currentTotal = currentN.reduce((a, b) => a + b, 0);
    const pctComplete = Math.min(100, (currentTotal / totalRequired) * 100);

    parts.push("");
    parts.push(`Current status: [${currentN.join(", ")}] (${currentTotal} total, ${pctComplete.toFixed(0)}% of required)`);
    parts.push(`Current power: ${(currentPower * 100).toFixed(1)}%`);

    if (currentPower >= desiredPower) {
      parts.push("Experiment has reached target power — ready for analysis.");
    } else {
      parts.push(`Experiment is underpowered. Need ${totalRequired - currentTotal} more observations.`);
    }
  }

  return parts.join("\n");
}
