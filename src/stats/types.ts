export interface ConfidenceInterval {
  lower: number;
  upper: number;
  level: number;
}

export interface StatisticalTestResult {
  testName: string;
  testStatistic: number;
  pValue: number;
  confidenceInterval: ConfidenceInterval;
  effectSize: number;
  relativeEffectSize: number | null;
  significant: boolean;
  alpha: number;
  interpretation: string;
}

export type Alternative = "two-sided" | "less" | "greater";

export interface TTestInput {
  control: { mean: number; stdDev: number; n: number };
  treatment: { mean: number; stdDev: number; n: number };
  alpha?: number;
  alternative?: Alternative;
}

export interface ZTestInput {
  control: { successes: number; n: number };
  treatment: { successes: number; n: number };
  alpha?: number;
  alternative?: Alternative;
}
