import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GrowthbookAdapter,
  GrowthbookApiError,
} from "../../src/platforms/growthbook.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: new Headers(),
    redirected: false,
    statusText: "OK",
    type: "basic",
    url: "",
    clone: () => jsonResponse(body, status) as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: new Headers(),
    redirected: false,
    statusText: "Error",
    type: "basic",
    url: "",
    clone: () => errorResponse(status, body) as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response;
}

const API_URL = "https://gb.example.com";
const API_KEY = "test-key";

function makeGbExperiment(overrides: Record<string, unknown> = {}) {
  return {
    id: "exp_abc123",
    trackingKey: "checkout-flow",
    name: "Checkout Flow Test",
    status: "running",
    archived: false,
    variations: [
      { variationId: "v1", key: "control", name: "Control", weight: 0.5 },
      { variationId: "v2", key: "variant", name: "Variant", weight: 0.5 },
    ],
    metrics: [
      { id: "metric_conv", name: "Conversion Rate", type: "binomial" },
    ],
    tags: ["checkout", "q1"],
    dateStarted: "2025-01-01",
    dateEnded: undefined,
    ...overrides,
  };
}

describe("GrowthbookAdapter", () => {
  let adapter: GrowthbookAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    adapter = new GrowthbookAdapter(API_KEY, API_URL);
  });

  describe("listExperiments", () => {
    it("paginates through all experiments", async () => {
      const exp1 = makeGbExperiment({ id: "exp_1", trackingKey: "exp-1" });
      const exp2 = makeGbExperiment({ id: "exp_2", trackingKey: "exp-2" });

      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            experiments: [exp1],
            hasMore: true,
            limit: 100,
            offset: 0,
            count: 1,
            total: 2,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            experiments: [exp2],
            hasMore: false,
            limit: 100,
            offset: 100,
            count: 1,
            total: 2,
          }),
        );

      const result = await adapter.listExperiments();

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe("exp-1");
      expect(result[1].key).toBe("exp-2");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        `${API_URL}/api/v1/experiments?limit=100&offset=0`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${API_KEY}`,
          }),
        }),
      );
    });

    it("applies client-side status and tag filters", async () => {
      const running = makeGbExperiment({
        id: "exp_1",
        trackingKey: "exp-1",
        status: "running",
        tags: ["checkout"],
      });
      const stopped = makeGbExperiment({
        id: "exp_2",
        trackingKey: "exp-2",
        status: "stopped",
        tags: ["checkout"],
      });
      const draft = makeGbExperiment({
        id: "exp_3",
        trackingKey: "exp-3",
        status: "draft",
        tags: ["other"],
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          experiments: [running, stopped, draft],
          hasMore: false,
        }),
      );

      const result = await adapter.listExperiments({
        status: ["running"],
        tags: ["checkout"],
      });

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("exp-1");
    });

    it("applies limit and offset after filtering", async () => {
      const experiments = Array.from({ length: 5 }, (_, i) =>
        makeGbExperiment({
          id: `exp_${i}`,
          trackingKey: `exp-${i}`,
          status: "running",
        }),
      );

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ experiments, hasMore: false }),
      );

      const result = await adapter.listExperiments({
        status: ["running"],
        offset: 1,
        limit: 2,
      });

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe("exp-1");
      expect(result[1].key).toBe("exp-2");
    });
  });

  describe("getExperiment", () => {
    it("resolves trackingKey and fetches experiment", async () => {
      const gbExp = makeGbExperiment();

      // First call: resolveExperimentId lookup
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          experiments: [{ id: "exp_abc123", trackingKey: "checkout-flow" }],
        }),
      );
      // Second call: GET experiment by id
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ experiment: gbExp }),
      );

      const result = await adapter.getExperiment("checkout-flow");

      expect(result.id).toBe("exp_abc123");
      expect(result.key).toBe("checkout-flow");
      expect(result.name).toBe("Checkout Flow Test");
      expect(result.variants).toHaveLength(2);
      expect(result.variants[0].id).toBe("v1");
      expect(result.status).toBe("running");
      expect(result.metrics[0].key).toBe("metric_conv");
      expect(result.dateStarted).toBe("2025-01-01");
    });

    it("uses cached id on subsequent calls", async () => {
      const gbExp = makeGbExperiment();

      // First call: resolve + fetch
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            experiments: [{ id: "exp_abc123", trackingKey: "checkout-flow" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ experiment: gbExp }));

      await adapter.getExperiment("checkout-flow");

      // Second call: only fetch (id is cached)
      mockFetch.mockResolvedValueOnce(jsonResponse({ experiment: gbExp }));

      await adapter.getExperiment("checkout-flow");

      // 3 total calls: resolve, fetch, fetch (no second resolve)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("maps archived experiments correctly", async () => {
      const gbExp = makeGbExperiment({
        archived: true,
        status: "stopped",
      });

      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            experiments: [{ id: "exp_abc123", trackingKey: "checkout-flow" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ experiment: gbExp }));

      const result = await adapter.getExperiment("checkout-flow");
      expect(result.status).toBe("archived");
    });
  });

  describe("createExperiment", () => {
    it("sends correct POST body and maps response", async () => {
      const gbExp = makeGbExperiment();

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ experiment: gbExp }),
      );

      const result = await adapter.createExperiment({
        key: "checkout-flow",
        name: "Checkout Flow Test",
        variants: [
          { key: "control", name: "Control", weight: 0.5 },
          { key: "variant", name: "Variant", weight: 0.5 },
        ],
        metrics: [{ name: "Conversion Rate", type: "binomial" }],
        tags: ["checkout"],
      });

      expect(result.key).toBe("checkout-flow");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API_URL}/api/v1/experiments`);
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.trackingKey).toBe("checkout-flow");
      expect(body.name).toBe("Checkout Flow Test");
      expect(body.variations).toEqual([
        { key: "control", name: "Control", weight: 0.5 },
        { key: "variant", name: "Variant", weight: 0.5 },
      ]);
      expect(body.metrics).toEqual([
        { id: "Conversion Rate", name: "Conversion Rate", type: "binomial" },
      ]);
      expect(body.tags).toEqual(["checkout"]);
    });
  });

  describe("updateExperiment", () => {
    it("resolves key and sends updates", async () => {
      const gbExp = makeGbExperiment({ name: "Updated Name" });

      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            experiments: [{ id: "exp_abc123", trackingKey: "checkout-flow" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ experiment: gbExp }));

      const result = await adapter.updateExperiment("checkout-flow", {
        name: "Updated Name",
        tags: ["new-tag"],
      });

      expect(result.name).toBe("Updated Name");

      const [url, opts] = mockFetch.mock.calls[1];
      expect(url).toBe(`${API_URL}/api/v1/experiments/exp_abc123`);
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.name).toBe("Updated Name");
      expect(body.tags).toEqual(["new-tag"]);
    });
  });

  describe("setExperimentStatus", () => {
    it("sends archived: true for archived status", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            experiments: [{ id: "exp_abc123", trackingKey: "checkout-flow" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ experiment: {} }));

      await adapter.setExperimentStatus("checkout-flow", "archived");

      const [, opts] = mockFetch.mock.calls[1];
      const body = JSON.parse(opts.body);
      expect(body).toEqual({ archived: true });
    });

    it("sends status field for non-archived statuses", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            experiments: [{ id: "exp_abc123", trackingKey: "checkout-flow" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ experiment: {} }));

      await adapter.setExperimentStatus("checkout-flow", "running");

      const [, opts] = mockFetch.mock.calls[1];
      const body = JSON.parse(opts.body);
      expect(body).toEqual({ status: "running" });
    });
  });

  describe("getFeatureFlag", () => {
    it("maps feature flag using default environment", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          feature: {
            id: "dark-mode",
            environments: {
              production: {
                enabled: true,
                rules: [{ type: "force", value: true }],
              },
              staging: {
                enabled: false,
                rules: [],
              },
            },
          },
        }),
      );

      const result = await adapter.getFeatureFlag("dark-mode");

      expect(result.key).toBe("dark-mode");
      expect(result.enabled).toBe(true);
      expect(result.rules).toEqual([{ type: "force", value: true }]);
    });

    it("uses custom environment when configured", async () => {
      const customAdapter = new GrowthbookAdapter(API_KEY, API_URL, {
        defaultEnvironment: "staging",
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          feature: {
            id: "dark-mode",
            environments: {
              production: { enabled: true, rules: [] },
              staging: {
                enabled: false,
                rules: [{ type: "rollout", value: 0.5 }],
              },
            },
          },
        }),
      );

      const result = await customAdapter.getFeatureFlag("dark-mode");

      expect(result.enabled).toBe(false);
      expect(result.rules).toEqual([{ type: "rollout", value: 0.5 }]);
    });

    it("defaults to disabled when environment not found", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          feature: {
            id: "dark-mode",
            environments: {},
          },
        }),
      );

      const result = await adapter.getFeatureFlag("dark-mode");

      expect(result.enabled).toBe(false);
      expect(result.rules).toEqual([]);
    });
  });

  describe("upsertFeatureFlag", () => {
    it("updates existing feature flag", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          feature: {
            id: "dark-mode",
            environments: {
              production: { enabled: true, rules: [] },
            },
          },
        }),
      );

      const result = await adapter.upsertFeatureFlag({
        key: "dark-mode",
        enabled: true,
        rules: [],
      });

      expect(result.key).toBe("dark-mode");
      expect(result.enabled).toBe(true);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${API_URL}/api/v1/features/dark-mode`);
      expect(opts.method).toBe("POST");

      const body = JSON.parse(opts.body);
      expect(body.environments.production.enabled).toBe(true);
    });

    it("creates feature flag on 404", async () => {
      // First call: 404 on update
      mockFetch.mockResolvedValueOnce(
        errorResponse(404, '{"message":"Not found"}'),
      );
      // Second call: create
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          feature: {
            id: "new-flag",
            environments: {
              production: { enabled: true, rules: [] },
            },
          },
        }),
      );

      const result = await adapter.upsertFeatureFlag({
        key: "new-flag",
        enabled: true,
        rules: [],
      });

      expect(result.key).toBe("new-flag");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [createUrl, createOpts] = mockFetch.mock.calls[1];
      expect(createUrl).toBe(`${API_URL}/api/v1/features`);
      expect(createOpts.method).toBe("POST");

      const body = JSON.parse(createOpts.body);
      expect(body.id).toBe("new-flag");
    });
  });

  describe("getAssignments", () => {
    it("throws with descriptive error", async () => {
      await expect(adapter.getAssignments("checkout-flow")).rejects.toThrow(
        "GrowthBook computes assignments client-side; server-side assignment listing is not supported.",
      );
    });
  });

  describe("API error handling", () => {
    it("throws GrowthbookApiError with correct fields", async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(403, '{"message":"Forbidden"}'),
      );

      try {
        await adapter.getFeatureFlag("some-flag");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GrowthbookApiError);
        const apiErr = err as GrowthbookApiError;
        expect(apiErr.statusCode).toBe(403);
        expect(apiErr.responseBody).toBe('{"message":"Forbidden"}');
        expect(apiErr.path).toBe("/features/some-flag");
        expect(apiErr.message).toContain("403");
        expect(apiErr.message).toContain("/features/some-flag");
      }
    });

    it("throws when experiment trackingKey not found", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ experiments: [] }),
      );

      await expect(adapter.getExperiment("nonexistent")).rejects.toThrow(
        'Experiment with trackingKey "nonexistent" not found',
      );
    });
  });
});
