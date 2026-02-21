import type {
  DataSource,
  EventDataOptions,
  ExperimentMetricData,
  MetricDefinition,
  QueryResult,
} from "../interfaces/data-source.js";

export class AthenaAdapter implements DataSource {
  constructor(
    private database: string,
    private workgroup: string,
    private outputLocation: string
  ) {}

  async executeQuery(
    _sql: string,
    _params?: unknown[]
  ): Promise<QueryResult> {
    throw new Error(
      "AthenaAdapter.executeQuery not implemented. " +
        "Implement this method to connect to AWS Athena."
    );
  }

  async getExperimentMetrics(
    _experimentKey: string,
    _metricKeys: string[]
  ): Promise<ExperimentMetricData[]> {
    throw new Error(
      "AthenaAdapter.getExperimentMetrics not implemented."
    );
  }

  async getEventData(_options: EventDataOptions): Promise<QueryResult> {
    throw new Error(
      "AthenaAdapter.getEventData not implemented."
    );
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    throw new Error(
      "AthenaAdapter.listMetrics not implemented."
    );
  }

  async healthCheck(): Promise<boolean> {
    throw new Error(
      "AthenaAdapter.healthCheck not implemented."
    );
  }
}
