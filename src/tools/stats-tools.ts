import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  twoSampleTTest,
  twoProportionZTest,
  nonInferiorityTest,
  multiArmAnalysis,
  checkGuardrails,
  analyzeFunnel,
  calculatePower,
  checkMaturity,
  decomposeMetric,
} from "../stats/index.js";

export function createStatsTools() {
  const runTTest = tool(
    async (input) => {
      const result = twoSampleTTest({
        control: {
          mean: input.controlMean,
          stdDev: input.controlStdDev,
          n: input.controlN,
        },
        treatment: {
          mean: input.treatmentMean,
          stdDev: input.treatmentStdDev,
          n: input.treatmentN,
        },
        alpha: input.alpha,
        alternative: input.alternative as any,
      });
      return JSON.stringify(result);
    },
    {
      name: "run_t_test",
      description:
        "Run Welch's two-sample t-test to compare means between treatment and control groups. " +
        "Use this for continuous metrics (revenue, duration, etc).",
      schema: z.object({
        controlMean: z.number().describe("Control group mean"),
        controlStdDev: z.number().describe("Control group standard deviation"),
        controlN: z.number().int().describe("Control group sample size"),
        treatmentMean: z.number().describe("Treatment group mean"),
        treatmentStdDev: z
          .number()
          .describe("Treatment group standard deviation"),
        treatmentN: z.number().int().describe("Treatment group sample size"),
        alpha: z
          .number()
          .optional()
          .describe("Significance level (default 0.05)"),
        alternative: z
          .enum(["two-sided", "less", "greater"])
          .optional()
          .describe("Alternative hypothesis (default two-sided)"),
      }),
    }
  );

  const runZTest = tool(
    async (input) => {
      const result = twoProportionZTest({
        control: {
          successes: input.controlSuccesses,
          n: input.controlN,
        },
        treatment: {
          successes: input.treatmentSuccesses,
          n: input.treatmentN,
        },
        alpha: input.alpha,
        alternative: input.alternative as any,
      });
      return JSON.stringify(result);
    },
    {
      name: "run_z_test",
      description:
        "Run a two-proportion z-test to compare binary outcome rates between treatment and control. " +
        "Use this for conversion rates, click-through rates, etc.",
      schema: z.object({
        controlSuccesses: z
          .number()
          .int()
          .describe("Number of successes in control group"),
        controlN: z.number().int().describe("Control group sample size"),
        treatmentSuccesses: z
          .number()
          .int()
          .describe("Number of successes in treatment group"),
        treatmentN: z.number().int().describe("Treatment group sample size"),
        alpha: z
          .number()
          .optional()
          .describe("Significance level (default 0.05)"),
        alternative: z
          .enum(["two-sided", "less", "greater"])
          .optional()
          .describe("Alternative hypothesis (default two-sided)"),
      }),
    }
  );

  const runNonInferiorityTest = tool(
    async (input) => {
      const result = nonInferiorityTest({
        control: {
          mean: input.controlMean,
          stdDev: input.controlStdDev,
          n: input.controlN,
        },
        treatment: {
          mean: input.treatmentMean,
          stdDev: input.treatmentStdDev,
          n: input.treatmentN,
        },
        margin: input.margin,
        marginType: input.marginType as any,
        metricType: input.metricType as any,
        alpha: input.alpha,
      });
      return JSON.stringify(result);
    },
    {
      name: "run_non_inferiority_test",
      description:
        "Run a non-inferiority test. Tests whether the treatment is not meaningfully worse than control. " +
        "H0: treatment - control ≤ -δ (inferior). Reject → non-inferior (PASS). " +
        "Use this instead of two-sided tests when shorter trial wins if it doesn't hurt the metric.",
      schema: z.object({
        controlMean: z.number().describe("Control group mean (or proportion for binary)"),
        controlStdDev: z.number().describe("Control group standard deviation"),
        controlN: z.number().int().describe("Control group sample size"),
        treatmentMean: z.number().describe("Treatment group mean (or proportion for binary)"),
        treatmentStdDev: z.number().describe("Treatment group standard deviation"),
        treatmentN: z.number().int().describe("Treatment group sample size"),
        margin: z.number().describe("Non-inferiority margin δ (e.g., 0.10 for 10% relative)"),
        marginType: z.enum(["relative", "absolute"]).optional().describe("Whether margin is relative to control mean or absolute (default relative)"),
        metricType: z.enum(["continuous", "binary"]).optional().describe("Metric type (default continuous)"),
        alpha: z.number().optional().describe("Significance level (default 0.10 for non-inferiority)"),
      }),
    }
  );

  const runMultiArmAnalysis = tool(
    async (input) => {
      const result = multiArmAnalysis({
        variants: input.variants,
        controlKey: input.controlKey,
        margin: input.margin,
        marginType: input.marginType as any,
        metricType: input.metricType as any,
        alpha: input.alpha,
      });
      return JSON.stringify(result);
    },
    {
      name: "run_multi_arm_analysis",
      description:
        "Analyze a multi-arm experiment with non-inferiority testing and Holm-Bonferroni correction. " +
        "Runs pairwise non-inferiority tests for each challenger vs control, " +
        "corrects for multiple comparisons, and recommends a winner.",
      schema: z.object({
        variants: z.array(z.object({
          key: z.string().describe("Variant identifier"),
          n: z.number().int().describe("Sample size"),
          mean: z.number().describe("Mean value"),
          stdDev: z.number().describe("Standard deviation"),
          successes: z.number().int().optional().describe("Number of successes (for binary metrics)"),
        })).describe("Array of variant statistics"),
        controlKey: z.string().describe("Key of the control variant"),
        margin: z.number().describe("Non-inferiority margin δ"),
        marginType: z.enum(["relative", "absolute"]).optional().describe("Margin type (default relative)"),
        metricType: z.enum(["continuous", "binary"]).optional().describe("Metric type (default continuous)"),
        alpha: z.number().optional().describe("Significance level (default 0.10)"),
      }),
    }
  );

  const runCheckGuardrails = tool(
    async (input) => {
      const result = checkGuardrails(input.guardrails.map((g) => ({
        metric: g.metric,
        controlStats: { mean: g.controlMean, stdDev: g.controlStdDev, n: g.controlN },
        treatmentStats: { mean: g.treatmentMean, stdDev: g.treatmentStdDev, n: g.treatmentN },
        threshold: g.threshold,
        thresholdType: g.thresholdType as any,
        direction: g.direction as any,
      })));
      return JSON.stringify(result);
    },
    {
      name: "check_guardrails",
      description:
        "Check hard constraints (guardrails) for an experiment. " +
        "Returns PASS, FAIL, or INCONCLUSIVE for each metric based on one-sided tests. " +
        "Also computes observed power to flag underpowered guardrails.",
      schema: z.object({
        guardrails: z.array(z.object({
          metric: z.string().describe("Guardrail metric name"),
          controlMean: z.number().describe("Control mean/proportion"),
          controlStdDev: z.number().describe("Control std dev"),
          controlN: z.number().int().describe("Control sample size"),
          treatmentMean: z.number().describe("Treatment mean/proportion"),
          treatmentStdDev: z.number().describe("Treatment std dev"),
          treatmentN: z.number().int().describe("Treatment sample size"),
          threshold: z.number().describe("Threshold value (e.g., 0.05 for 5% relative, 0.01 for 1pp absolute)"),
          thresholdType: z.enum(["relative", "absolute"]).describe("Whether threshold is relative or absolute"),
          direction: z.enum(["no_decrease", "no_increase"]).describe("Direction of concern"),
        })).describe("Array of guardrail checks to perform"),
      }),
    }
  );

  const runAnalyzeFunnel = tool(
    async (input) => {
      const result = analyzeFunnel({
        stages: input.stages,
        variants: input.variants,
      });
      return JSON.stringify(result);
    },
    {
      name: "analyze_funnel",
      description:
        "Analyze a conversion funnel across experiment variants. " +
        "Computes stage-by-stage conversion rates with Wilson CIs, " +
        "compares stages across variants, and identifies bottleneck stages. " +
        "First variant in the array is treated as control.",
      schema: z.object({
        stages: z.array(z.string()).describe("Funnel stage names in order (e.g., ['Registered', 'Trial', 'Paid', 'Retained'])"),
        variants: z.array(z.object({
          key: z.string().describe("Variant identifier"),
          counts: z.array(z.number().int()).describe("Number of users reaching each stage (must match stages length)"),
        })).describe("Variant funnel data"),
      }),
    }
  );

  const runCalculatePower = tool(
    async (input) => {
      const result = calculatePower({
        baseline: input.baseline,
        mde: input.mde,
        alpha: input.alpha,
        power: input.power,
        allocationRatios: input.allocationRatios,
        metricType: input.metricType as any,
        baselineStdDev: input.baselineStdDev,
        currentN: input.currentN,
      });
      return JSON.stringify(result);
    },
    {
      name: "calculate_power",
      description:
        "Calculate required sample size or check current power for an experiment. " +
        "Supports unequal allocation ratios (e.g., 20/40/40 split). " +
        "If currentN is provided, computes achieved power.",
      schema: z.object({
        baseline: z.number().describe("Baseline rate (binary) or mean (continuous)"),
        mde: z.number().describe("Minimum detectable effect (relative for binary, absolute for continuous)"),
        alpha: z.number().optional().describe("Significance level (default 0.05)"),
        power: z.number().optional().describe("Desired power (default 0.80)"),
        allocationRatios: z.array(z.number()).optional().describe("Allocation ratios per variant (default [0.5, 0.5])"),
        metricType: z.enum(["continuous", "binary"]).optional().describe("Metric type (default binary)"),
        baselineStdDev: z.number().optional().describe("Baseline std dev (required for continuous metrics)"),
        currentN: z.array(z.number().int()).optional().describe("Current sample sizes per variant (for mid-flight power check)"),
      }),
    }
  );

  const runCheckMaturity = tool(
    async (input) => {
      const result = checkMaturity({
        experimentStartDate: input.experimentStartDate,
        variants: input.variants,
        observationWindowDays: input.observationWindowDays,
        currentDate: input.currentDate,
        registrantsPerDay: input.registrantsPerDay,
      });
      return JSON.stringify(result);
    },
    {
      name: "check_maturity",
      description:
        "Check temporal readiness for a trial-length experiment. " +
        "Different trial lengths need different observation windows. " +
        "Flags if variants have unequal maturity and computes fair comparison date. " +
        "Run this FIRST before any other analysis.",
      schema: z.object({
        experimentStartDate: z.string().describe("Experiment start date (YYYY-MM-DD)"),
        variants: z.array(z.object({
          key: z.string().describe("Variant identifier"),
          trialDays: z.number().int().describe("Trial length in days"),
        })).describe("Variant trial configurations"),
        observationWindowDays: z.number().int().describe("Days after trial to observe (e.g., 30 for 1-month LTV)"),
        currentDate: z.string().describe("Current date (YYYY-MM-DD)"),
        registrantsPerDay: z.number().optional().describe("Average daily registrants (for richer info)"),
      }),
    }
  );

  const runDecomposeMetric = tool(
    async (input) => {
      const result = decomposeMetric({
        segments: input.segments,
      });
      return JSON.stringify(result);
    },
    {
      name: "decompose_metric",
      description:
        "Decompose a metric change into rate vs mix effects using Shapley decomposition. " +
        "Answers: is the metric difference because behavior changed (rate effect) " +
        "or because different types of users converted (mix effect)?",
      schema: z.object({
        segments: z.array(z.object({
          name: z.string().describe("Segment name"),
          controlCount: z.number().int().describe("Control count in this segment"),
          controlRate: z.number().describe("Control metric rate in this segment"),
          treatmentCount: z.number().int().describe("Treatment count in this segment"),
          treatmentRate: z.number().describe("Treatment metric rate in this segment"),
        })).describe("Segment-level data for decomposition"),
      }),
    }
  );

  return [
    runTTest,
    runZTest,
    runNonInferiorityTest,
    runMultiArmAnalysis,
    runCheckGuardrails,
    runAnalyzeFunnel,
    runCalculatePower,
    runCheckMaturity,
    runDecomposeMetric,
  ];
}
