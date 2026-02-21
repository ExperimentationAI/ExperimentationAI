export interface DecompositionSegment {
  name: string;
  controlCount: number;
  controlRate: number;
  treatmentCount: number;
  treatmentRate: number;
}

export interface DecompositionInput {
  segments: DecompositionSegment[];
}

export interface SegmentContribution {
  name: string;
  rateContribution: number;
  mixContribution: number;
  controlWeight: number;
  treatmentWeight: number;
  controlRate: number;
  treatmentRate: number;
}

export interface DecompositionResult {
  totalChange: number;
  rateEffect: number;
  mixEffect: number;
  segments: SegmentContribution[];
  interpretation: string;
}

/**
 * Shapley decomposition of a metric change into rate vs mix effects.
 *
 * If LTV differs between control and treatment, is it because:
 * - Rate effect: conversion rates changed within segments
 * - Mix effect: the composition of segments changed
 *
 * Uses Shapley values to attribute the change fairly:
 *   ΔMetric = Σ(w̄ᵢ × Δrᵢ) + Σ(r̄ᵢ × Δwᵢ)
 * where w̄ᵢ = (wᵢ_control + wᵢ_treatment) / 2  (average weight)
 *       r̄ᵢ = (rᵢ_control + rᵢ_treatment) / 2  (average rate)
 *       Δrᵢ = rᵢ_treatment - rᵢ_control          (rate change)
 *       Δwᵢ = wᵢ_treatment - wᵢ_control          (mix change)
 */
export function decomposeMetric(input: DecompositionInput): DecompositionResult {
  const { segments } = input;

  if (segments.length === 0) {
    throw new Error("At least one segment is required");
  }

  // Compute totals
  const totalControlCount = segments.reduce((sum, s) => sum + s.controlCount, 0);
  const totalTreatmentCount = segments.reduce((sum, s) => sum + s.treatmentCount, 0);

  if (totalControlCount === 0 || totalTreatmentCount === 0) {
    throw new Error("Both control and treatment must have non-zero total counts");
  }

  // Compute overall weighted rates
  const overallControl = segments.reduce(
    (sum, s) => sum + (s.controlCount / totalControlCount) * s.controlRate, 0
  );
  const overallTreatment = segments.reduce(
    (sum, s) => sum + (s.treatmentCount / totalTreatmentCount) * s.treatmentRate, 0
  );
  const totalChange = overallTreatment - overallControl;

  // Shapley decomposition per segment
  let rateEffect = 0;
  let mixEffect = 0;
  const segmentContributions: SegmentContribution[] = [];

  for (const seg of segments) {
    const wControl = seg.controlCount / totalControlCount;
    const wTreatment = seg.treatmentCount / totalTreatmentCount;

    const wAvg = (wControl + wTreatment) / 2;
    const rAvg = (seg.controlRate + seg.treatmentRate) / 2;

    const deltaR = seg.treatmentRate - seg.controlRate;
    const deltaW = wTreatment - wControl;

    const rateContrib = wAvg * deltaR;
    const mixContrib = rAvg * deltaW;

    rateEffect += rateContrib;
    mixEffect += mixContrib;

    segmentContributions.push({
      name: seg.name,
      rateContribution: rateContrib,
      mixContribution: mixContrib,
      controlWeight: wControl,
      treatmentWeight: wTreatment,
      controlRate: seg.controlRate,
      treatmentRate: seg.treatmentRate,
    });
  }

  // Validate additivity: rate + mix should equal total change
  const residual = Math.abs(totalChange - rateEffect - mixEffect);
  if (residual > 1e-8) {
    // Shapley decomposition with this approach can have small residuals
    // due to the interaction term. Distribute it proportionally.
    const scale = totalChange / (rateEffect + mixEffect || 1);
    rateEffect *= scale;
    mixEffect *= scale;
    for (const s of segmentContributions) {
      s.rateContribution *= scale;
      s.mixContribution *= scale;
    }
  }

  const interpretation = buildDecompositionInterpretation(
    totalChange, rateEffect, mixEffect, segmentContributions
  );

  return { totalChange, rateEffect, mixEffect, segments: segmentContributions, interpretation };
}

function buildDecompositionInterpretation(
  totalChange: number,
  rateEffect: number,
  mixEffect: number,
  segments: SegmentContribution[],
): string {
  const parts: string[] = [];

  const pctRate = totalChange !== 0 ? (rateEffect / totalChange) * 100 : 0;
  const pctMix = totalChange !== 0 ? (mixEffect / totalChange) * 100 : 0;

  parts.push(
    `Total metric change: ${totalChange.toFixed(6)} ` +
    `= ${rateEffect.toFixed(6)} (rate effect, ${pctRate.toFixed(0)}%) ` +
    `+ ${mixEffect.toFixed(6)} (mix effect, ${pctMix.toFixed(0)}%)`
  );

  if (Math.abs(pctRate) > Math.abs(pctMix) * 2) {
    parts.push(
      "The change is primarily driven by RATE effects — actual behavior changed within segments."
    );
  } else if (Math.abs(pctMix) > Math.abs(pctRate) * 2) {
    parts.push(
      "The change is primarily driven by MIX effects — the composition of the population shifted."
    );
  } else {
    parts.push("Both rate and mix effects contribute meaningfully to the overall change.");
  }

  // Highlight top contributors
  const sorted = [...segments].sort(
    (a, b) => Math.abs(b.rateContribution + b.mixContribution) -
              Math.abs(a.rateContribution + a.mixContribution)
  );

  if (sorted.length > 0) {
    parts.push("");
    parts.push("Top contributing segments:");
    for (const s of sorted.slice(0, 3)) {
      parts.push(
        `  "${s.name}": rate=${s.rateContribution.toFixed(6)}, mix=${s.mixContribution.toFixed(6)} ` +
        `(control: ${(s.controlRate * 100).toFixed(1)}% @ ${(s.controlWeight * 100).toFixed(1)}% weight, ` +
        `treatment: ${(s.treatmentRate * 100).toFixed(1)}% @ ${(s.treatmentWeight * 100).toFixed(1)}% weight)`
      );
    }
  }

  return parts.join("\n");
}
