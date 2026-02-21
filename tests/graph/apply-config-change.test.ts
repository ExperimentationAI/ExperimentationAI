import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExperimentPlatform } from "../../src/interfaces/experiment-platform.js";
import type { AgentStateType } from "../../src/graph/state.js";

// Mock interrupt before importing the module under test
const mockInterrupt = vi.fn();
vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    interrupt: (...args: unknown[]) => mockInterrupt(...args),
  };
});

import { createApplyConfigChangeNode } from "../../src/graph/nodes/apply-config-change.js";

function makeState(overrides: Partial<AgentStateType> = {}): AgentStateType {
  return {
    messages: [],
    experimentKey: "test-exp",
    phase: "done",
    metricResults: [],
    statisticalResults: [],
    conclusion: "Test conclusion",
    priorConclusions: [],
    userContext: null,
    correlationId: "corr-123",
    replyTo: null,
    configProposal: null,
    configChangeResult: null,
    errors: [],
    ...overrides,
  } as AgentStateType;
}

describe("apply_config_change node", () => {
  let mockPlatform: ExperimentPlatform;
  let applyNode: ReturnType<typeof createApplyConfigChangeNode>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPlatform = {
      listExperiments: vi.fn(),
      getExperiment: vi.fn().mockResolvedValue({
        id: "exp-1",
        key: "test-exp",
        name: "Test",
        variants: [
          { id: "v0", key: "control", name: "Control", weight: 0.5 },
          { id: "v1", key: "treatment", name: "Treatment", weight: 0.5 },
        ],
        status: "running",
        metrics: [],
        tags: [],
      }),
      createExperiment: vi.fn(),
      updateExperiment: vi.fn().mockResolvedValue({}),
      setExperimentStatus: vi.fn().mockResolvedValue(undefined),
      getFeatureFlag: vi.fn(),
      upsertFeatureFlag: vi.fn().mockResolvedValue({
        key: "feat",
        enabled: true,
        rules: [],
      }),
      getAssignments: vi.fn(),
    };

    applyNode = createApplyConfigChangeNode(mockPlatform);
  });

  it("passes through when configProposal is null", async () => {
    const result = await applyNode(makeState());

    expect(result).toEqual({});
    expect(mockInterrupt).not.toHaveBeenCalled();
  });

  it("interrupts and executes set_status on approval", async () => {
    mockInterrupt.mockReturnValue({ approved: true });

    const state = makeState({
      configProposal: {
        action: "set_status",
        experimentKey: "test-exp",
        status: "stopped",
        reason: "Kill it",
      },
    });

    const result = await applyNode(state);

    expect(mockInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal: state.configProposal,
      })
    );
    expect(mockPlatform.setExperimentStatus).toHaveBeenCalledWith(
      "test-exp",
      "stopped"
    );
    expect(result.configChangeResult?.approved).toBe(true);
    expect(result.configChangeResult?.action).toBe("set_status");
  });

  it("rejects on disapproval", async () => {
    mockInterrupt.mockReturnValue({ approved: false });

    const state = makeState({
      configProposal: {
        action: "set_status",
        experimentKey: "test-exp",
        status: "stopped",
        reason: "Kill it",
      },
    });

    const result = await applyNode(state);

    expect(result.configChangeResult?.approved).toBe(false);
    expect(result.configChangeResult?.action).toBe("set_status");
    expect(mockPlatform.setExperimentStatus).not.toHaveBeenCalled();
  });

  it("executes update_weights on approval", async () => {
    mockInterrupt.mockReturnValue({ approved: true });

    const state = makeState({
      configProposal: {
        action: "update_weights",
        experimentKey: "test-exp",
        weights: [
          { variantKey: "control", weight: 0.1 },
          { variantKey: "treatment", weight: 0.9 },
        ],
        reason: "Shift traffic",
      },
    });

    const result = await applyNode(state);

    expect(mockPlatform.getExperiment).toHaveBeenCalledWith("test-exp");
    expect(mockPlatform.updateExperiment).toHaveBeenCalledWith("test-exp", {
      variants: [
        { id: "v0", key: "control", name: "Control", weight: 0.1 },
        { id: "v1", key: "treatment", name: "Treatment", weight: 0.9 },
      ],
    });
    expect(result.configChangeResult?.approved).toBe(true);
    expect(result.configChangeResult?.action).toBe("update_weights");
  });

  it("executes update_feature_flag on approval", async () => {
    mockInterrupt.mockReturnValue({ approved: true });

    const state = makeState({
      configProposal: {
        action: "update_feature_flag",
        featureKey: "my-feature",
        enabled: true,
        reason: "Ship it",
      },
    });

    const result = await applyNode(state);

    expect(mockPlatform.upsertFeatureFlag).toHaveBeenCalledWith({
      key: "my-feature",
      enabled: true,
      rules: [],
    });
    expect(result.configChangeResult?.approved).toBe(true);
    expect(result.configChangeResult?.action).toBe("update_feature_flag");
  });

  it("captures errors during execution", async () => {
    mockInterrupt.mockReturnValue({ approved: true });
    (mockPlatform.setExperimentStatus as any).mockRejectedValue(
      new Error("API timeout")
    );

    const state = makeState({
      configProposal: {
        action: "set_status",
        experimentKey: "test-exp",
        status: "stopped",
        reason: "Kill it",
      },
    });

    const result = await applyNode(state);

    expect(result.configChangeResult?.approved).toBe(true);
    expect(result.configChangeResult?.error).toBe("API timeout");
  });
});
