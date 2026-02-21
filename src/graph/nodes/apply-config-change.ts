import { interrupt } from "@langchain/langgraph";
import type { ExperimentPlatform } from "../../interfaces/experiment-platform.js";
import type { AgentStateType, AgentUpdateType } from "../state.js";
import type { ConfigChangeResult } from "../state.js";

export function createApplyConfigChangeNode(platform: ExperimentPlatform) {
  return async (state: AgentStateType): Promise<Partial<AgentUpdateType>> => {
    if (!state.configProposal) {
      return {};
    }

    const proposal = state.configProposal;

    // Pause execution and ask the human for approval
    const answer = interrupt({
      proposal,
      message: `Config change proposed: ${proposal.action} — ${proposal.reason}`,
    });

    if (!answer?.approved) {
      const result: ConfigChangeResult = {
        approved: false,
        action: proposal.action,
        timestamp: new Date().toISOString(),
      };
      return { configChangeResult: result };
    }

    // Execute the approved change
    try {
      switch (proposal.action) {
        case "set_status":
          await platform.setExperimentStatus(
            proposal.experimentKey,
            proposal.status
          );
          break;

        case "update_weights": {
          // Fetch current experiment to get full variant details
          const experiment = await platform.getExperiment(
            proposal.experimentKey
          );
          const updatedVariants = experiment.variants.map((v) => {
            const weightUpdate = proposal.weights.find(
              (w) => w.variantKey === v.key
            );
            return weightUpdate ? { ...v, weight: weightUpdate.weight } : v;
          });
          await platform.updateExperiment(proposal.experimentKey, {
            variants: updatedVariants,
          });
          break;
        }

        case "update_feature_flag":
          await platform.upsertFeatureFlag({
            key: proposal.featureKey,
            enabled: proposal.enabled,
            rules: proposal.rules ?? [],
          });
          break;
      }

      const result: ConfigChangeResult = {
        approved: true,
        action: proposal.action,
        timestamp: new Date().toISOString(),
      };
      return { configChangeResult: result };
    } catch (err) {
      const result: ConfigChangeResult = {
        approved: true,
        action: proposal.action,
        error: (err as Error).message,
        timestamp: new Date().toISOString(),
      };
      return { configChangeResult: result };
    }
  };
}
