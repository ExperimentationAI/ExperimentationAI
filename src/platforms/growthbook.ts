import type {
  Assignment,
  Experiment,
  ExperimentPlatform,
  ExperimentStatus,
  FeatureFlag,
  ListExperimentsOptions,
  Variant,
} from "../interfaces/experiment-platform.js";

export class GrowthbookAdapter implements ExperimentPlatform {
  constructor(
    private apiKey: string,
    private apiUrl: string
  ) {}

  async listExperiments(_options?: ListExperimentsOptions): Promise<Experiment[]> {
    throw new Error(
      "GrowthbookAdapter.listExperiments not implemented. " +
        "Implement this method to connect to the Growthbook API."
    );
  }

  async getExperiment(_key: string): Promise<Experiment> {
    throw new Error(
      "GrowthbookAdapter.getExperiment not implemented. " +
        "Implement this method to connect to the Growthbook API."
    );
  }

  async createExperiment(_params: {
    key: string;
    name: string;
    variants: Omit<Variant, "id">[];
  }): Promise<Experiment> {
    throw new Error(
      "GrowthbookAdapter.createExperiment not implemented."
    );
  }

  async updateExperiment(
    _key: string,
    _updates: Partial<Pick<Experiment, "name" | "tags" | "metrics">>
  ): Promise<Experiment> {
    throw new Error(
      "GrowthbookAdapter.updateExperiment not implemented."
    );
  }

  async setExperimentStatus(
    _key: string,
    _status: ExperimentStatus
  ): Promise<void> {
    throw new Error(
      "GrowthbookAdapter.setExperimentStatus not implemented."
    );
  }

  async getFeatureFlag(_key: string): Promise<FeatureFlag> {
    throw new Error(
      "GrowthbookAdapter.getFeatureFlag not implemented."
    );
  }

  async upsertFeatureFlag(_flag: FeatureFlag): Promise<FeatureFlag> {
    throw new Error(
      "GrowthbookAdapter.upsertFeatureFlag not implemented."
    );
  }

  async getAssignments(
    _experimentKey: string,
    _options?: { limit?: number; offset?: number }
  ): Promise<Assignment[]> {
    throw new Error(
      "GrowthbookAdapter.getAssignments not implemented."
    );
  }
}
