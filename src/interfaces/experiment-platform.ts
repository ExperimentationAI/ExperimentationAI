export interface Variant {
  id: string;
  key: string;
  name: string;
  weight: number;
}

export type ExperimentStatus = "draft" | "running" | "stopped" | "archived";

export interface ExperimentMetric {
  key: string;
  name: string;
  type: "binomial" | "count" | "duration" | "revenue";
}

export interface Experiment {
  id: string;
  key: string;
  name: string;
  variants: Variant[];
  status: ExperimentStatus;
  metrics: ExperimentMetric[];
  tags: string[];
  dateStarted?: string;
  dateEnded?: string;
}

export interface ListExperimentsOptions {
  status?: ExperimentStatus[];
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rules: Record<string, unknown>[];
}

export interface Assignment {
  userId: string;
  variantKey: string;
  assignedAt: string;
}

export interface ExperimentPlatform {
  listExperiments(options?: ListExperimentsOptions): Promise<Experiment[]>;
  getExperiment(key: string): Promise<Experiment>;
  createExperiment(params: {
    key: string;
    name: string;
    variants: Omit<Variant, "id">[];
    metrics?: Omit<ExperimentMetric, "key">[];
    tags?: string[];
  }): Promise<Experiment>;
  updateExperiment(
    key: string,
    updates: Partial<Pick<Experiment, "name" | "tags" | "metrics">>
  ): Promise<Experiment>;
  setExperimentStatus(key: string, status: ExperimentStatus): Promise<void>;
  getFeatureFlag(key: string): Promise<FeatureFlag>;
  upsertFeatureFlag(flag: FeatureFlag): Promise<FeatureFlag>;
  getAssignments(
    experimentKey: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Assignment[]>;
}
