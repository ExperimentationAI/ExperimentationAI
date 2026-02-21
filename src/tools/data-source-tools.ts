import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../interfaces/data-source.js";

export function createDataSourceTools(dataSource: DataSource) {
  const executeQuery = tool(
    async (input) => {
      const result = await dataSource.executeQuery(input.sql);
      return JSON.stringify(result);
    },
    {
      name: "execute_query",
      description:
        "Execute a SQL query against the data warehouse. Returns columns, rows, and row count.",
      schema: z.object({
        sql: z.string().describe("The SQL query to execute"),
      }),
    }
  );

  const getExperimentMetrics = tool(
    async (input) => {
      const metrics = await dataSource.getExperimentMetrics(
        input.experimentKey,
        input.metricKeys
      );
      return JSON.stringify(metrics);
    },
    {
      name: "get_experiment_metrics",
      description:
        "Get aggregated metric data for an experiment, broken down by variant. " +
        "Returns sample size, mean, stdDev, and successes (for binary metrics) per variant.",
      schema: z.object({
        experimentKey: z.string().describe("The experiment key"),
        metricKeys: z
          .array(z.string())
          .describe("List of metric keys to retrieve"),
      }),
    }
  );

  const getEventData = tool(
    async (input) => {
      const result = await dataSource.getEventData({
        experimentKey: input.experimentKey,
        eventName: input.eventName,
        startDate: input.startDate,
        endDate: input.endDate,
        variantKey: input.variantKey,
        limit: input.limit,
      });
      return JSON.stringify(result);
    },
    {
      name: "get_event_data",
      description:
        "Get raw event-level data for an experiment. Useful for exploring individual events.",
      schema: z.object({
        experimentKey: z.string().describe("The experiment key"),
        eventName: z.string().describe("The event name to query"),
        startDate: z.string().optional().describe("Start date (ISO 8601)"),
        endDate: z.string().optional().describe("End date (ISO 8601)"),
        variantKey: z.string().optional().describe("Filter by variant"),
        limit: z.number().optional().describe("Max rows to return"),
      }),
    }
  );

  const listMetrics = tool(
    async () => {
      const metrics = await dataSource.listMetrics();
      return JSON.stringify(metrics);
    },
    {
      name: "list_metrics",
      description:
        "List all available metrics in the data warehouse with their types.",
      schema: z.object({}),
    }
  );

  return [executeQuery, getExperimentMetrics, getEventData, listMetrics];
}
