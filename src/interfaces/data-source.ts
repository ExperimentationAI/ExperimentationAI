export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface VariantMetricData {
  variantKey: string;
  sampleSize: number;
  mean: number;
  stdDev: number;
  /** For binary/proportion metrics */
  successes?: number;
}

export interface ExperimentMetricData {
  metricKey: string;
  metricType: "continuous" | "binary";
  variants: VariantMetricData[];
}

export interface EventDataOptions {
  experimentKey: string;
  eventName: string;
  startDate?: string;
  endDate?: string;
  variantKey?: string;
  limit?: number;
}

export interface MetricDefinition {
  key: string;
  name: string;
  description?: string;
  type: "continuous" | "binary";
}

export interface DataSource {
  executeQuery(sql: string, params?: unknown[]): Promise<QueryResult>;
  getExperimentMetrics(
    experimentKey: string,
    metricKeys: string[]
  ): Promise<ExperimentMetricData[]>;
  getEventData(options: EventDataOptions): Promise<QueryResult>;
  listMetrics(): Promise<MetricDefinition[]>;
  healthCheck(): Promise<boolean>;
}
