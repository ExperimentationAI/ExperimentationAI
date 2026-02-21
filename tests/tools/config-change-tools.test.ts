import { describe, it, expect, vi, beforeEach } from "vitest";
import { createConfigChangeTools } from "../../src/tools/config-change-tools.js";
import type { ExperimentPlatform } from "../../src/interfaces/experiment-platform.js";

describe("propose_config_change tool", () => {
  let mockPlatform: ExperimentPlatform;
  let proposeTool: ReturnType<typeof createConfigChangeTools>[0];

  beforeEach(() => {
    mockPlatform = {
      listExperiments: vi.fn(),
      getExperiment: vi.fn().mockResolvedValue({
        id: "exp-1",
        key: "test-exp",
        name: "Test Experiment",
        variants: [
          { id: "v0", key: "control", name: "Control", weight: 0.5 },
          { id: "v1", key: "treatment", name: "Treatment", weight: 0.5 },
        ],
        status: "running",
        metrics: [],
        tags: [],
      }),
      createExperiment: vi.fn(),
      updateExperiment: vi.fn(),
      setExperimentStatus: vi.fn(),
      getFeatureFlag: vi.fn(),
      upsertFeatureFlag: vi.fn(),
      getAssignments: vi.fn(),
    };

    const tools = createConfigChangeTools(mockPlatform);
    proposeTool = tools[0];
  });

  it("has the correct name", () => {
    expect(proposeTool.name).toBe("propose_config_change");
  });

  describe("set_status action", () => {
    it("proposes status change for existing experiment", async () => {
      const result = JSON.parse(
        await proposeTool.invoke({
          action: "set_status",
          experimentKey: "test-exp",
          status: "stopped",
          reason: "Experiment shows clear winner",
        })
      );

      expect(result.proposed).toBe(true);
      expect(result.action).toBe("set_status");
      expect(result.summary).toContain("test-exp");
      expect(result.summary).toContain("stopped");
      expect(mockPlatform.getExperiment).toHaveBeenCalledWith("test-exp");
    });

    it("rejects when experiment not found", async () => {
      (mockPlatform.getExperiment as any).mockRejectedValue(
        new Error('Experiment with trackingKey "bad-key" not found')
      );

      const result = JSON.parse(
        await proposeTool.invoke({
          action: "set_status",
          experimentKey: "bad-key",
          status: "stopped",
          reason: "Stop it",
        })
      );

      expect(result.proposed).toBe(false);
      expect(result.error).toContain("Experiment not found");
    });
  });

  describe("update_weights action", () => {
    it("proposes weight update for valid variants", async () => {
      const result = JSON.parse(
        await proposeTool.invoke({
          action: "update_weights",
          experimentKey: "test-exp",
          weights: [
            { variantKey: "control", weight: 0.2 },
            { variantKey: "treatment", weight: 0.8 },
          ],
          reason: "Shift traffic to winning variant",
        })
      );

      expect(result.proposed).toBe(true);
      expect(result.summary).toContain("test-exp");
      expect(result.summary).toContain("control=0.2");
      expect(result.summary).toContain("treatment=0.8");
    });

    it("rejects weights that don't sum to 1.0", async () => {
      const result = JSON.parse(
        await proposeTool.invoke({
          action: "update_weights",
          experimentKey: "test-exp",
          weights: [
            { variantKey: "control", weight: 0.3 },
            { variantKey: "treatment", weight: 0.3 },
          ],
          reason: "Bad weights",
        })
      );

      expect(result.proposed).toBe(false);
      expect(result.error).toContain("Weights must sum to 1.0");
    });

    it("rejects unknown variant keys", async () => {
      const result = JSON.parse(
        await proposeTool.invoke({
          action: "update_weights",
          experimentKey: "test-exp",
          weights: [
            { variantKey: "control", weight: 0.5 },
            { variantKey: "nonexistent", weight: 0.5 },
          ],
          reason: "Bad variant",
        })
      );

      expect(result.proposed).toBe(false);
      expect(result.error).toContain("Unknown variant keys");
      expect(result.error).toContain("nonexistent");
    });
  });

  describe("update_feature_flag action", () => {
    it("proposes feature flag update without experiment validation", async () => {
      const result = JSON.parse(
        await proposeTool.invoke({
          action: "update_feature_flag",
          featureKey: "my-feature",
          enabled: true,
          reason: "Enable winning variant",
        })
      );

      expect(result.proposed).toBe(true);
      expect(result.summary).toContain("my-feature");
      expect(result.summary).toContain("enabled=true");
      // Feature flag actions don't call getExperiment
      expect(mockPlatform.getExperiment).not.toHaveBeenCalled();
    });

    it("proposes feature flag with rules", async () => {
      const result = JSON.parse(
        await proposeTool.invoke({
          action: "update_feature_flag",
          featureKey: "my-feature",
          enabled: true,
          rules: [{ type: "force", value: true }],
          reason: "Enable with force rule",
        })
      );

      expect(result.proposed).toBe(true);
    });
  });
});
