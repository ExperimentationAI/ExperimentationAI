import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { InMemoryStore } from "@langchain/langgraph";

export function createMemoryTools(store: InMemoryStore) {
  const searchPastConclusions = tool(
    async (input) => {
      const results = await store.search(
        ["experiments", "conclusions"],
        {
          query: input.query,
          limit: input.limit ?? 10,
        }
      );
      return JSON.stringify(
        results.map((r) => ({
          key: r.key,
          value: r.value,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }))
      );
    },
    {
      name: "search_past_conclusions",
      description:
        "Search past experiment conclusions and analysis results stored in memory. " +
        "Useful for understanding historical trends and prior findings.",
      schema: z.object({
        query: z
          .string()
          .describe("Search query for finding relevant past conclusions"),
        limit: z
          .number()
          .optional()
          .describe("Max number of results (default 10)"),
      }),
    }
  );

  const getLearnings = tool(
    async (input) => {
      const results = await store.search(
        ["experiments", input.experimentKey, "conclusions"],
        { limit: input.limit ?? 20 }
      );
      return JSON.stringify(
        results.map((r) => ({
          key: r.key,
          value: r.value,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }))
      );
    },
    {
      name: "get_learnings",
      description:
        "Get past analysis conclusions for a specific experiment. " +
        "Returns historical analyses ordered by time.",
      schema: z.object({
        experimentKey: z
          .string()
          .describe("The experiment key to look up"),
        limit: z
          .number()
          .optional()
          .describe("Max number of results (default 20)"),
      }),
    }
  );

  return [searchPastConclusions, getLearnings];
}
