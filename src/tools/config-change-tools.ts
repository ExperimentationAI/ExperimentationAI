import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ExperimentPlatform } from "../interfaces/experiment-platform.js";

const SetStatusSchema = z.object({
  action: z.literal("set_status"),
  experimentKey: z.string().describe("The experiment key to update"),
  status: z
    .enum(["draft", "running", "stopped", "archived"])
    .describe("New status for the experiment"),
  reason: z.string().describe("Why this change is recommended"),
});

const UpdateWeightsSchema = z.object({
  action: z.literal("update_weights"),
  experimentKey: z.string().describe("The experiment key to update"),
  weights: z
    .array(
      z.object({
        variantKey: z.string(),
        weight: z.number().min(0).max(1),
      })
    )
    .describe("New traffic weights for each variant (must sum to 1.0)"),
  reason: z.string().describe("Why this change is recommended"),
});

const UpdateFeatureFlagSchema = z.object({
  action: z.literal("update_feature_flag"),
  featureKey: z.string().describe("The feature flag key"),
  enabled: z.boolean().describe("Whether to enable the flag"),
  rules: z
    .array(z.record(z.unknown()))
    .optional()
    .describe("Optional targeting rules"),
  reason: z.string().describe("Why this change is recommended"),
});

const ConfigChangeSchema = z.discriminatedUnion("action", [
  SetStatusSchema,
  UpdateWeightsSchema,
  UpdateFeatureFlagSchema,
]);

export function createConfigChangeTools(platform: ExperimentPlatform) {
  const proposeConfigChange = tool(
    async (input) => {
      // Validate experiment exists for experiment-scoped actions
      if (input.action === "set_status" || input.action === "update_weights") {
        try {
          const experiment = await platform.getExperiment(input.experimentKey);

          // For weight updates, validate variant keys exist and weights sum to 1.0
          if (input.action === "update_weights") {
            const weightSum = input.weights.reduce((s, w) => s + w.weight, 0);
            if (Math.abs(weightSum - 1.0) > 0.001) {
              return JSON.stringify({
                proposed: false,
                error: `Weights must sum to 1.0, got ${weightSum}`,
              });
            }

            const validKeys = new Set(experiment.variants.map((v) => v.key));
            const invalid = input.weights.filter(
              (w) => !validKeys.has(w.variantKey)
            );
            if (invalid.length > 0) {
              return JSON.stringify({
                proposed: false,
                error: `Unknown variant keys: ${invalid.map((w) => w.variantKey).join(", ")}. Valid keys: ${[...validKeys].join(", ")}`,
              });
            }
          }
        } catch (err) {
          return JSON.stringify({
            proposed: false,
            error: `Experiment not found: ${(err as Error).message}`,
          });
        }
      }

      const summary =
        input.action === "set_status"
          ? `Set experiment "${input.experimentKey}" status to "${input.status}"`
          : input.action === "update_weights"
            ? `Update traffic weights for "${input.experimentKey}": ${input.weights.map((w) => `${w.variantKey}=${w.weight}`).join(", ")}`
            : `Update feature flag "${input.featureKey}": enabled=${input.enabled}`;

      return JSON.stringify({
        proposed: true,
        summary,
        action: input.action,
        reason: input.reason,
      });
    },
    {
      name: "propose_config_change",
      description:
        "Propose a configuration change to the experiment platform. " +
        "The change will NOT be executed immediately — it requires human approval. " +
        "Use this after reaching a conclusion to recommend a concrete action: " +
        "stop an experiment, update traffic weights, or toggle a feature flag. " +
        "Call this at most once per analysis.",
      schema: ConfigChangeSchema,
    }
  );

  return [proposeConfigChange];
}
