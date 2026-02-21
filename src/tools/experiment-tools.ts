import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ExperimentPlatform } from "../interfaces/experiment-platform.js";

export function createExperimentTools(platform: ExperimentPlatform) {
  const listExperiments = tool(
    async (input) => {
      const experiments = await platform.listExperiments({
        status: input.status as any,
        tags: input.tags,
        limit: input.limit,
      });
      return JSON.stringify(experiments);
    },
    {
      name: "list_experiments",
      description:
        "List experiments from the platform, optionally filtered by status and tags.",
      schema: z.object({
        status: z
          .array(z.enum(["draft", "running", "stopped", "archived"]))
          .optional()
          .describe("Filter by experiment status"),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
        limit: z.number().optional().describe("Max results to return"),
      }),
    }
  );

  const getExperiment = tool(
    async (input) => {
      const experiment = await platform.getExperiment(input.key);
      return JSON.stringify(experiment);
    },
    {
      name: "get_experiment",
      description:
        "Get full details of a specific experiment by its key, including variants, metrics, and status.",
      schema: z.object({
        key: z.string().describe("The experiment key"),
      }),
    }
  );

  const createExperiment = tool(
    async (input) => {
      const experiment = await platform.createExperiment({
        key: input.key,
        name: input.name,
        variants: input.variants,
        tags: input.tags,
      });
      return JSON.stringify(experiment);
    },
    {
      name: "create_experiment",
      description: "Create a new experiment on the platform.",
      schema: z.object({
        key: z.string().describe("Unique experiment key"),
        name: z.string().describe("Human-readable experiment name"),
        variants: z
          .array(
            z.object({
              key: z.string(),
              name: z.string(),
              weight: z.number(),
            })
          )
          .describe("Experiment variants with weights"),
        tags: z.array(z.string()).optional().describe("Tags for the experiment"),
      }),
    }
  );

  const updateExperiment = tool(
    async (input) => {
      const experiment = await platform.updateExperiment(input.key, {
        name: input.name,
        tags: input.tags,
      });
      return JSON.stringify(experiment);
    },
    {
      name: "update_experiment",
      description: "Update an existing experiment's name or tags.",
      schema: z.object({
        key: z.string().describe("The experiment key"),
        name: z.string().optional().describe("New experiment name"),
        tags: z.array(z.string()).optional().describe("New tags"),
      }),
    }
  );

  const getAssignments = tool(
    async (input) => {
      const assignments = await platform.getAssignments(input.experimentKey, {
        limit: input.limit,
      });
      return JSON.stringify(assignments);
    },
    {
      name: "get_assignments",
      description: "Get user variant assignments for an experiment.",
      schema: z.object({
        experimentKey: z.string().describe("The experiment key"),
        limit: z.number().optional().describe("Max assignments to return"),
      }),
    }
  );

  return [
    listExperiments,
    getExperiment,
    createExperiment,
    updateExperiment,
    getAssignments,
  ];
}
