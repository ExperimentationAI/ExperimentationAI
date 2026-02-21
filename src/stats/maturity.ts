export interface MaturityVariant {
  key: string;
  /** Trial length in days for this variant */
  trialDays: number;
}

export interface MaturityInput {
  experimentStartDate: string;
  variants: MaturityVariant[];
  /** How many days after trial ends to observe the user (e.g., 30 for 1-month LTV) */
  observationWindowDays: number;
  currentDate: string;
  /** Average registrants per day per variant (optional, for richer readiness info) */
  registrantsPerDay?: number;
}

export interface VariantMaturity {
  key: string;
  trialDays: number;
  /** Total days from registration to full observation */
  totalDaysNeeded: number;
  /** Date when first user in this variant has full observation */
  firstFullReadDate: string;
  /** Percentage of users with complete observation window */
  pctMature: number;
  /** Days until all currently registered users are mature */
  daysUntilAllMature: number;
}

export interface MaturityResult {
  ready: boolean;
  variantMaturity: VariantMaturity[];
  /** Earliest date when all variants have equal maturity */
  fairComparisonDate: string;
  warnings: string[];
}

/**
 * Check maturity / temporal readiness for a trial-length experiment.
 *
 * Different trial lengths mean different observation windows.
 * A 3-day trial user completes observation 3+30=33 days after registration,
 * while a 14-day trial user needs 14+30=44 days.
 *
 * This tool checks if enough time has elapsed for fair comparison.
 */
export function checkMaturity(input: MaturityInput): MaturityResult {
  const { experimentStartDate, variants, observationWindowDays, currentDate } = input;

  const startDate = new Date(experimentStartDate);
  const today = new Date(currentDate);
  const daysSinceStart = Math.floor(
    (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceStart < 0) {
    return {
      ready: false,
      variantMaturity: variants.map((v) => ({
        key: v.key,
        trialDays: v.trialDays,
        totalDaysNeeded: v.trialDays + observationWindowDays,
        firstFullReadDate: addDays(experimentStartDate, v.trialDays + observationWindowDays),
        pctMature: 0,
        daysUntilAllMature: v.trialDays + observationWindowDays,
      })),
      fairComparisonDate: addDays(
        experimentStartDate,
        Math.max(...variants.map((v) => v.trialDays)) + observationWindowDays
      ),
      warnings: ["Experiment has not started yet."],
    };
  }

  const variantMaturity: VariantMaturity[] = variants.map((v) => {
    const totalDaysNeeded = v.trialDays + observationWindowDays;
    const firstFullReadDate = addDays(experimentStartDate, totalDaysNeeded);

    // Users who registered on day d are mature if daysSinceStart - d >= totalDaysNeeded
    // i.e., d <= daysSinceStart - totalDaysNeeded
    // Assuming uniform registration over all days since start
    const matureDays = Math.max(0, daysSinceStart - totalDaysNeeded + 1);
    const totalRegistrationDays = daysSinceStart + 1;
    const pctMature = Math.min(1, matureDays / totalRegistrationDays);

    // Days until the most recently registered user is mature
    const daysUntilAllMature = Math.max(0, totalDaysNeeded - daysSinceStart);

    return {
      key: v.key,
      trialDays: v.trialDays,
      totalDaysNeeded,
      firstFullReadDate,
      pctMature,
      daysUntilAllMature,
    };
  });

  // Fair comparison date: when the slowest variant's first user is fully mature
  const maxTotalDays = Math.max(...variants.map((v) => v.trialDays + observationWindowDays));
  const fairComparisonDate = addDays(experimentStartDate, maxTotalDays);

  // Warnings
  const warnings: string[] = [];

  // Check if any variant is completely immature
  const immature = variantMaturity.filter((v) => v.pctMature === 0);
  if (immature.length > 0) {
    warnings.push(
      `Variants with no mature users yet: ${immature.map((v) => `"${v.key}" (needs ${v.daysUntilAllMature} more days)`).join(", ")}`
    );
  }

  // Check maturity imbalance
  const pctValues = variantMaturity.map((v) => v.pctMature);
  const maxPct = Math.max(...pctValues);
  const minPct = Math.min(...pctValues);
  if (maxPct - minPct > 0.1 && minPct > 0) {
    const fastest = variantMaturity.find((v) => v.pctMature === maxPct)!;
    const slowest = variantMaturity.find((v) => v.pctMature === minPct)!;
    warnings.push(
      `Maturity imbalance: "${fastest.key}" is ${(fastest.pctMature * 100).toFixed(0)}% mature ` +
      `vs "${slowest.key}" at ${(slowest.pctMature * 100).toFixed(0)}%. ` +
      `Comparing now may bias toward the shorter-trial variant.`
    );
  }

  // Check if we're past the fair comparison date
  const fairDate = new Date(fairComparisonDate);
  const ready = today >= fairDate && variantMaturity.every((v) => v.pctMature > 0);

  if (!ready && today < fairDate) {
    const daysUntilFair = Math.ceil(
      (fairDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    warnings.push(
      `Fair comparison date is ${fairComparisonDate} (${daysUntilFair} days away). ` +
      `Analysis before this date will have unequal observation windows across variants.`
    );
  }

  return { ready, variantMaturity, fairComparisonDate, warnings };
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}
