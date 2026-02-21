import { nonInferiorityTest, type NonInferiorityResult } from "./non-inferiority.js";

export interface VariantStats {
  key: string;
  n: number;
  mean: number;
  stdDev: number;
  /** For binary metrics */
  successes?: number;
}

export interface MultiArmInput {
  variants: VariantStats[];
  controlKey: string;
  margin: number;
  marginType?: "relative" | "absolute";
  metricType?: "continuous" | "binary";
  alpha?: number;
}

export interface PairwiseResult {
  treatmentKey: string;
  controlKey: string;
  rawPValue: number;
  adjustedPValue: number;
  nonInferior: boolean;
  observedDiff: number;
  result: NonInferiorityResult;
}

export interface MultiArmResult {
  pairwise: PairwiseResult[];
  recommendation: string;
  winner: string | null;
  correctionMethod: string;
}

/**
 * Multi-arm non-inferiority analysis with Holm-Bonferroni correction.
 *
 * Runs pairwise non-inferiority tests for each challenger vs control,
 * applies multiplicity correction, ranks passing variants by effect size,
 * and picks a winner.
 */
export function multiArmAnalysis(input: MultiArmInput): MultiArmResult {
  const { variants, controlKey } = input;
  const alpha = input.alpha ?? 0.10;
  const metricType = input.metricType ?? "continuous";
  const marginType = input.marginType ?? "relative";

  const control = variants.find((v) => v.key === controlKey);
  if (!control) {
    throw new Error(`Control variant "${controlKey}" not found in variants`);
  }

  const challengers = variants.filter((v) => v.key !== controlKey);
  if (challengers.length === 0) {
    throw new Error("At least one challenger variant is required");
  }

  // Run pairwise non-inferiority tests
  const rawResults: { key: string; result: NonInferiorityResult }[] = [];
  for (const challenger of challengers) {
    const controlStats = metricType === "binary" && control.successes !== undefined
      ? { mean: control.successes / control.n, stdDev: 0, n: control.n }
      : { mean: control.mean, stdDev: control.stdDev, n: control.n };

    const treatmentStats = metricType === "binary" && challenger.successes !== undefined
      ? { mean: challenger.successes / challenger.n, stdDev: 0, n: challenger.n }
      : { mean: challenger.mean, stdDev: challenger.stdDev, n: challenger.n };

    // For binary, compute stdDev from proportions
    if (metricType === "binary") {
      const pc = controlStats.mean;
      const pt = treatmentStats.mean;
      controlStats.stdDev = Math.sqrt(pc * (1 - pc));
      treatmentStats.stdDev = Math.sqrt(pt * (1 - pt));
    }

    const result = nonInferiorityTest({
      control: controlStats,
      treatment: treatmentStats,
      margin: input.margin,
      marginType,
      metricType,
      alpha, // We'll apply Holm-Bonferroni after
    });

    rawResults.push({ key: challenger.key, result });
  }

  // Holm-Bonferroni step-down correction
  const m = rawResults.length;
  const sorted = rawResults
    .map((r, i) => ({ ...r, index: i }))
    .sort((a, b) => a.result.pValue - b.result.pValue);

  const pairwise: PairwiseResult[] = [];
  let allPassing = true;

  for (let rank = 0; rank < sorted.length; rank++) {
    const item = sorted[rank];
    const adjustedAlpha = alpha / (m - rank);
    const adjustedPValue = Math.min(item.result.pValue * (m - rank), 1);
    const nonInferior = allPassing && item.result.pValue < adjustedAlpha;

    if (!nonInferior) {
      allPassing = false; // Holm step-down: once one fails, all subsequent fail
    }

    pairwise.push({
      treatmentKey: item.key,
      controlKey,
      rawPValue: item.result.pValue,
      adjustedPValue,
      nonInferior,
      observedDiff: item.result.observedDiff,
      result: item.result,
    });
  }

  // Sort back by original order (by key for consistency)
  pairwise.sort((a, b) => a.treatmentKey.localeCompare(b.treatmentKey));

  // Pick winner: among passing variants, prefer the one with best business case
  // For trial length experiment: shorter trial that passes non-inferiority wins
  const passing = pairwise.filter((p) => p.nonInferior);
  let winner: string | null = null;
  let recommendation: string;

  if (passing.length === 0) {
    recommendation =
      "No challenger variant passed the non-inferiority test after Holm-Bonferroni correction. " +
      "Recommend keeping the control.";
  } else if (passing.length === 1) {
    winner = passing[0].treatmentKey;
    recommendation =
      `Variant "${winner}" passes non-inferiority (adjusted p=${passing[0].adjustedPValue.toFixed(4)}). ` +
      `Observed difference: ${passing[0].observedDiff.toFixed(4)}. Recommend adopting "${winner}".`;
  } else {
    // Multiple passing — rank by effect size (higher = better)
    const ranked = [...passing].sort((a, b) => b.observedDiff - a.observedDiff);
    winner = ranked[0].treatmentKey;

    const passingList = passing.map((p) =>
      `"${p.treatmentKey}" (diff=${p.observedDiff.toFixed(4)}, adj. p=${p.adjustedPValue.toFixed(4)})`
    ).join(", ");

    recommendation =
      `Multiple variants pass non-inferiority: ${passingList}. ` +
      `Recommending "${winner}" based on largest positive effect. ` +
      `Consider business factors (e.g., shorter trial = faster cash velocity) for final decision.`;
  }

  return {
    pairwise,
    recommendation,
    winner,
    correctionMethod: "Holm-Bonferroni",
  };
}
