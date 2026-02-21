import type {
  Assignment,
  Experiment,
  ExperimentMetric,
  ExperimentPlatform,
  ExperimentStatus,
  FeatureFlag,
  ListExperimentsOptions,
  Variant,
} from "../interfaces/experiment-platform.js";

export class GrowthbookApiError extends Error {
  constructor(
    public statusCode: number,
    public responseBody: string,
    public path: string,
  ) {
    super(`GrowthBook API error ${statusCode} at ${path}: ${responseBody}`);
    this.name = "GrowthbookApiError";
  }
}

export interface GrowthbookAdapterOptions {
  defaultEnvironment?: string;
  assignmentQueryId?: string;
}

export class GrowthbookAdapter implements ExperimentPlatform {
  private defaultEnvironment: string;
  private assignmentQueryId?: string;
  private idCache = new Map<string, string>();

  constructor(
    private apiKey: string,
    private apiUrl: string,
    options?: GrowthbookAdapterOptions,
  ) {
    this.defaultEnvironment = options?.defaultEnvironment ?? "production";
    this.assignmentQueryId = options?.assignmentQueryId;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.apiUrl}/api/v1${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new GrowthbookApiError(res.status, body, path);
    }
    return (await res.json()) as T;
  }

  private async resolveExperimentId(key: string): Promise<string> {
    const cached = this.idCache.get(key);
    if (cached) return cached;

    const data = await this.request<{
      experiments: Array<{ id: string; trackingKey: string }>;
    }>(`/experiments?experimentId=${encodeURIComponent(key)}`);

    const match = data.experiments.find((e) => e.trackingKey === key);
    if (!match) {
      throw new Error(`Experiment with trackingKey "${key}" not found`);
    }
    this.idCache.set(key, match.id);
    return match.id;
  }

  private mapExperiment(gb: Record<string, unknown>): Experiment {
    const variations = gb.variations as Array<Record<string, unknown>> | undefined;
    const metrics = gb.metrics as Array<Record<string, unknown>> | undefined;
    const tags = gb.tags as string[] | undefined;

    return {
      id: gb.id as string,
      key: gb.trackingKey as string,
      name: gb.name as string,
      variants: (variations ?? []).map((v) => ({
        id: v.variationId as string,
        key: v.key as string,
        name: v.name as string,
        weight: v.weight as number,
      })),
      status: gb.archived === true ? "archived" : (gb.status as ExperimentStatus),
      metrics: (metrics ?? []).map((m) => ({
        key: m.id as string,
        name: m.name as string,
        type: (m.type as ExperimentMetric["type"]) ?? "binomial",
      })),
      tags: tags ?? [],
      ...(gb.dateStarted ? { dateStarted: gb.dateStarted as string } : {}),
      ...(gb.dateEnded ? { dateEnded: gb.dateEnded as string } : {}),
    };
  }

  private mapFeatureFlag(gb: Record<string, unknown>): FeatureFlag {
    const environments = gb.environments as
      | Record<string, { enabled?: boolean; rules?: Record<string, unknown>[] }>
      | undefined;
    const envConfig = environments?.[this.defaultEnvironment];

    return {
      key: gb.id as string,
      enabled: envConfig?.enabled ?? false,
      rules: envConfig?.rules ?? [],
    };
  }

  async listExperiments(options?: ListExperimentsOptions): Promise<Experiment[]> {
    const all: Experiment[] = [];
    let offset = 0;
    const pageSize = 100;

    while (true) {
      const data = await this.request<{
        experiments: Array<Record<string, unknown>>;
        hasMore: boolean;
      }>(`/experiments?limit=${pageSize}&offset=${offset}`);

      for (const raw of data.experiments) {
        all.push(this.mapExperiment(raw));
      }

      if (!data.hasMore) break;
      offset += pageSize;
    }

    let filtered = all;

    if (options?.status?.length) {
      filtered = filtered.filter((e) => options.status!.includes(e.status));
    }
    if (options?.tags?.length) {
      filtered = filtered.filter((e) =>
        options.tags!.some((t) => e.tags.includes(t)),
      );
    }

    const start = options?.offset ?? 0;
    const end = options?.limit ? start + options.limit : undefined;
    return filtered.slice(start, end);
  }

  async getExperiment(key: string): Promise<Experiment> {
    const id = await this.resolveExperimentId(key);
    const data = await this.request<{ experiment: Record<string, unknown> }>(
      `/experiments/${id}`,
    );
    return this.mapExperiment(data.experiment);
  }

  async createExperiment(params: {
    key: string;
    name: string;
    variants: Omit<Variant, "id">[];
    metrics?: Omit<ExperimentMetric, "key">[];
    tags?: string[];
  }): Promise<Experiment> {
    const body = {
      name: params.name,
      trackingKey: params.key,
      variations: params.variants.map((v) => ({
        key: v.key,
        name: v.name,
        weight: v.weight,
      })),
      tags: params.tags ?? [],
      metrics:
        params.metrics?.map((m) => ({
          id: m.name,
          name: m.name,
          type: m.type,
        })) ?? [],
    };
    const data = await this.request<{ experiment: Record<string, unknown> }>(
      "/experiments",
      { method: "POST", body: JSON.stringify(body) },
    );
    return this.mapExperiment(data.experiment);
  }

  async updateExperiment(
    key: string,
    updates: Partial<Pick<Experiment, "name" | "tags" | "metrics">>,
  ): Promise<Experiment> {
    const id = await this.resolveExperimentId(key);
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.tags !== undefined) body.tags = updates.tags;
    if (updates.metrics !== undefined) {
      body.metrics = updates.metrics.map((m) => ({
        id: m.key,
        name: m.name,
        type: m.type,
      }));
    }
    const data = await this.request<{ experiment: Record<string, unknown> }>(
      `/experiments/${id}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return this.mapExperiment(data.experiment);
  }

  async setExperimentStatus(
    key: string,
    status: ExperimentStatus,
  ): Promise<void> {
    const id = await this.resolveExperimentId(key);
    const body =
      status === "archived" ? { archived: true } : { status };
    await this.request(`/experiments/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getFeatureFlag(key: string): Promise<FeatureFlag> {
    const data = await this.request<{ feature: Record<string, unknown> }>(
      `/features/${key}`,
    );
    return this.mapFeatureFlag(data.feature);
  }

  async upsertFeatureFlag(flag: FeatureFlag): Promise<FeatureFlag> {
    const body = {
      environments: {
        [this.defaultEnvironment]: {
          enabled: flag.enabled,
          rules: flag.rules,
        },
      },
    };
    try {
      const data = await this.request<{ feature: Record<string, unknown> }>(
        `/features/${flag.key}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      return this.mapFeatureFlag(data.feature);
    } catch (err) {
      if (err instanceof GrowthbookApiError && err.statusCode === 404) {
        const createBody = {
          id: flag.key,
          ...body,
        };
        const data = await this.request<{ feature: Record<string, unknown> }>(
          "/features",
          { method: "POST", body: JSON.stringify(createBody) },
        );
        return this.mapFeatureFlag(data.feature);
      }
      throw err;
    }
  }

  async getAssignments(
    _experimentKey: string,
    _options?: { limit?: number; offset?: number },
  ): Promise<Assignment[]> {
    throw new Error(
      "GrowthBook computes assignments client-side; server-side assignment listing is not supported.",
    );
  }
}
