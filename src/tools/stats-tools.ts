import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { twoSampleTTest, twoProportionZTest } from "../stats/index.js";

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

  return [runTTest, runZTest];
}
