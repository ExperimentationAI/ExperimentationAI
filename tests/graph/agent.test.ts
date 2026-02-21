import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryStore } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { ExperimentPlatform } from "../../src/interfaces/experiment-platform.js";
import type { DataSource } from "../../src/interfaces/data-source.js";
import type { MessageBus } from "../../src/io/message-bus.js";
import type { AnalysisResult } from "../../src/io/types.js";
import {
  createExperimentTools,
  createDataSourceTools,
  createStatsTools,
  createMemoryTools,
  createConfigChangeTools,
} from "../../src/tools/index.js";

describe("Agent Graph Integration", () => {
  let mockPlatform: ExperimentPlatform;
  let mockDataSource: DataSource;
  let mockBus: MessageBus;
  let publishedResults: AnalysisResult[];

  beforeEach(() => {
    publishedResults = [];

    mockPlatform = {
      listExperiments: vi.fn().mockResolvedValue([
        {
          id: "exp-1",
          key: "test-experiment",
          name: "Test Experiment",
          variants: [
            { id: "v0", key: "control", name: "Control", weight: 0.5 },
            { id: "v1", key: "treatment", name: "Treatment", weight: 0.5 },
          ],
          status: "running",
          metrics: [
            { key: "conversion_rate", name: "Conversion Rate", type: "binomial" },
            { key: "revenue", name: "Revenue", type: "revenue" },
          ],
          tags: ["pricing"],
          dateStarted: "2025-01-01T00:00:00Z",
        },
      ]),
      getExperiment: vi.fn().mockResolvedValue({
        id: "exp-1",
        key: "test-experiment",
        name: "Test Experiment",
        variants: [
          { id: "v0", key: "control", name: "Control", weight: 0.5 },
          { id: "v1", key: "treatment", name: "Treatment", weight: 0.5 },
        ],
        status: "running",
        metrics: [
          { key: "conversion_rate", name: "Conversion Rate", type: "binomial" },
          { key: "revenue", name: "Revenue", type: "revenue" },
        ],
        tags: ["pricing"],
        dateStarted: "2025-01-01T00:00:00Z",
      }),
      createExperiment: vi.fn(),
      updateExperiment: vi.fn(),
      setExperimentStatus: vi.fn(),
      getFeatureFlag: vi.fn(),
      upsertFeatureFlag: vi.fn(),
      getAssignments: vi.fn().mockResolvedValue([]),
    };

    mockDataSource = {
      executeQuery: vi.fn().mockResolvedValue({
        columns: ["variant", "count"],
        rows: [],
        rowCount: 0,
      }),
      getExperimentMetrics: vi.fn().mockResolvedValue([
        {
          metricKey: "conversion_rate",
          metricType: "binary",
          variants: [
            { variantKey: "control", sampleSize: 1000, mean: 0.20, stdDev: 0.4, successes: 200 },
            { variantKey: "treatment", sampleSize: 1000, mean: 0.25, stdDev: 0.43, successes: 250 },
          ],
        },
        {
          metricKey: "revenue",
          metricType: "continuous",
          variants: [
            { variantKey: "control", sampleSize: 1000, mean: 50.0, stdDev: 25.0 },
            { variantKey: "treatment", sampleSize: 1000, mean: 55.0, stdDev: 28.0 },
          ],
        },
      ]),
      getEventData: vi.fn().mockResolvedValue({
        columns: [],
        rows: [],
        rowCount: 0,
      }),
      listMetrics: vi.fn().mockResolvedValue([
        { key: "conversion_rate", name: "Conversion Rate", type: "binary" },
        { key: "revenue", name: "Revenue", type: "continuous" },
      ]),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    mockBus = {
      consume: vi.fn(),
      publish: vi.fn().mockImplementation(async (result: AnalysisResult) => {
        publishedResults.push(result);
      }),
      close: vi.fn(),
    };
  });

  it("creates tools with correct names", () => {
    const store = new InMemoryStore();
    const experimentTools = createExperimentTools(mockPlatform);
    const dataSourceTools = createDataSourceTools(mockDataSource);
    const statsTools = createStatsTools();
    const memoryTools = createMemoryTools(store);
    const configChangeTools = createConfigChangeTools(mockPlatform);

    const toolNames = [
      ...experimentTools,
      ...dataSourceTools,
      ...statsTools,
      ...memoryTools,
      ...configChangeTools,
    ].map((t) => t.name);

    expect(toolNames).toContain("list_experiments");
    expect(toolNames).toContain("get_experiment");
    expect(toolNames).toContain("create_experiment");
    expect(toolNames).toContain("update_experiment");
    expect(toolNames).toContain("get_assignments");
    expect(toolNames).toContain("execute_query");
    expect(toolNames).toContain("get_experiment_metrics");
    expect(toolNames).toContain("get_event_data");
    expect(toolNames).toContain("list_metrics");
    expect(toolNames).toContain("run_t_test");
    expect(toolNames).toContain("run_z_test");
    expect(toolNames).toContain("search_past_conclusions");
    expect(toolNames).toContain("get_learnings");
    expect(toolNames).toContain("propose_config_change");
  });

  it("experiment tools call the platform correctly", async () => {
    const tools = createExperimentTools(mockPlatform);
    const getExpTool = tools.find((t) => t.name === "get_experiment")!;

    const result = await getExpTool.invoke({ key: "test-experiment" });
    expect(mockPlatform.getExperiment).toHaveBeenCalledWith("test-experiment");
    expect(result).toContain("test-experiment");
  });

  it("data source tools call the data source correctly", async () => {
    const tools = createDataSourceTools(mockDataSource);
    const metricsTool = tools.find(
      (t) => t.name === "get_experiment_metrics"
    )!;

    const result = await metricsTool.invoke({
      experimentKey: "test-experiment",
      metricKeys: ["conversion_rate", "revenue"],
    });

    expect(mockDataSource.getExperimentMetrics).toHaveBeenCalledWith(
      "test-experiment",
      ["conversion_rate", "revenue"]
    );
    expect(result).toContain("conversion_rate");
  });

  it("stats tools produce valid results", async () => {
    const tools = createStatsTools();
    const tTestTool = tools.find((t) => t.name === "run_t_test")!;
    const zTestTool = tools.find((t) => t.name === "run_z_test")!;

    const tResult = JSON.parse(
      await tTestTool.invoke({
        controlMean: 50.0,
        controlStdDev: 25.0,
        controlN: 1000,
        treatmentMean: 55.0,
        treatmentStdDev: 28.0,
        treatmentN: 1000,
      })
    );

    expect(tResult.testName).toBe("Welch's Two-Sample t-Test");
    expect(tResult.pValue).toBeDefined();
    expect(tResult.significant).toBeDefined();

    const zResult = JSON.parse(
      await zTestTool.invoke({
        controlSuccesses: 200,
        controlN: 1000,
        treatmentSuccesses: 250,
        treatmentN: 1000,
      })
    );

    expect(zResult.testName).toBe("Two-Proportion z-Test");
    expect(zResult.pValue).toBeDefined();
    expect(zResult.significant).toBe(true);
  });

  it("memory tools store and retrieve conclusions", async () => {
    const store = new InMemoryStore();
    const tools = createMemoryTools(store);

    // Store a conclusion
    await store.put(
      ["experiments", "test-experiment", "conclusions"],
      "item-1",
      {
        conclusion: "Treatment shows significant improvement in conversion.",
        timestamp: "2025-01-15T00:00:00Z",
      }
    );

    const getLearningsTool = tools.find((t) => t.name === "get_learnings")!;
    const result = JSON.parse(
      await getLearningsTool.invoke({
        experimentKey: "test-experiment",
      })
    );

    expect(result).toHaveLength(1);
    expect(result[0].value.conclusion).toContain("significant improvement");
  });

  it("publishes results through the message bus", async () => {
    const { createPublishResultNode } = await import(
      "../../src/graph/nodes/publish-result.js"
    );
    const publishNode = createPublishResultNode(mockBus);

    await publishNode({
      messages: [],
      experimentKey: "test-experiment",
      phase: "done",
      metricResults: [],
      statisticalResults: [
        {
          testName: "Two-Proportion z-Test",
          testStatistic: 2.63,
          pValue: 0.0085,
          confidenceInterval: { lower: 0.013, upper: 0.087, level: 0.95 },
          effectSize: 0.05,
          relativeEffectSize: 0.25,
          significant: true,
          alpha: 0.05,
          interpretation: "Treatment is significantly better.",
        },
      ],
      conclusion: "Treatment shows a 5pp improvement in conversion rate.\n\nRecommendation: Ship the treatment variant.",
      priorConclusions: [],
      userContext: null,
      correlationId: "corr-123",
      replyTo: { channel: "slack", destination: "C123" },
      errors: [],
    } as any);

    expect(mockBus.publish).toHaveBeenCalledOnce();
    const published = publishedResults[0];
    expect(published.type).toBe("experiment_analysis");
    expect(published.experimentKey).toBe("test-experiment");
    expect(published.correlationId).toBe("corr-123");
    expect(published.conclusion).toContain("5pp improvement");
    expect(published.statisticalResults).toHaveLength(1);
    expect(published.replyTo?.channel).toBe("slack");
  });
});
