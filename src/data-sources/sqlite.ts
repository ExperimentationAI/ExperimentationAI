import Database from "better-sqlite3";
import type {
  DataSource,
  EventDataOptions,
  ExperimentMetricData,
  MetricDefinition,
  QueryResult,
} from "../interfaces/data-source.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS metrics (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK(type IN ('continuous','binary'))
);

CREATE TABLE IF NOT EXISTS experiments (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_metrics (
  experiment_key TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  mean REAL NOT NULL,
  std_dev REAL NOT NULL,
  successes INTEGER,
  PRIMARY KEY(experiment_key, metric_key, variant_key),
  FOREIGN KEY(experiment_key) REFERENCES experiments(key),
  FOREIGN KEY(metric_key) REFERENCES metrics(key)
);

CREATE TABLE IF NOT EXISTS inclusion_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY(experiment_key) REFERENCES experiments(key)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  event_name TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  event_value REAL,
  event_params TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_uuid);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_inclusion_experiment ON inclusion_logs(experiment_key);
CREATE INDEX IF NOT EXISTS idx_inclusion_user ON inclusion_logs(user_uuid);
`;

const READ_PREFIXES = ["SELECT", "PRAGMA", "WITH", "EXPLAIN"];

export class SqliteDataSource implements DataSource {
  private db: Database.Database;

  constructor(dbPath: string = "./data/local.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    const trimmed = sql.trimStart().toUpperCase();
    const isRead = READ_PREFIXES.some((p) => trimmed.startsWith(p));

    if (isRead) {
      const rows = this.db.prepare(sql).all(...(params ?? [])) as Record<
        string,
        unknown
      >[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { columns, rows, rowCount: rows.length };
    }

    const result = this.db.prepare(sql).run(...(params ?? []));
    return {
      columns: ["changes", "lastInsertRowid"],
      rows: [
        {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        },
      ],
      rowCount: 1,
    };
  }

  async getExperimentMetrics(
    experimentKey: string,
    metricKeys: string[]
  ): Promise<ExperimentMetricData[]> {
    const placeholders = metricKeys.map(() => "?").join(",");
    const sql = `
      SELECT
        em.metric_key,
        m.type AS metric_type,
        em.variant_key,
        em.sample_size,
        em.mean,
        em.std_dev,
        em.successes
      FROM experiment_metrics em
      JOIN metrics m ON m.key = em.metric_key
      WHERE em.experiment_key = ?
        AND em.metric_key IN (${placeholders})
      ORDER BY em.metric_key, em.variant_key
    `;

    const rows = this.db
      .prepare(sql)
      .all(experimentKey, ...metricKeys) as Array<{
      metric_key: string;
      metric_type: "continuous" | "binary";
      variant_key: string;
      sample_size: number;
      mean: number;
      std_dev: number;
      successes: number | null;
    }>;

    const grouped = new Map<
      string,
      { metricType: "continuous" | "binary"; variants: ExperimentMetricData["variants"] }
    >();

    for (const row of rows) {
      let entry = grouped.get(row.metric_key);
      if (!entry) {
        entry = { metricType: row.metric_type, variants: [] };
        grouped.set(row.metric_key, entry);
      }
      entry.variants.push({
        variantKey: row.variant_key,
        sampleSize: row.sample_size,
        mean: row.mean,
        stdDev: row.std_dev,
        ...(row.successes != null ? { successes: row.successes } : {}),
      });
    }

    return Array.from(grouped.entries()).map(([metricKey, data]) => ({
      metricKey,
      metricType: data.metricType,
      variants: data.variants,
    }));
  }

  async getEventData(options: EventDataOptions): Promise<QueryResult> {
    const conditions: string[] = [
      "il.experiment_key = ?",
      "e.event_name = ?",
    ];
    const params: unknown[] = [options.experimentKey, options.eventName];

    if (options.startDate) {
      conditions.push("e.timestamp >= ?");
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push("e.timestamp <= ?");
      params.push(options.endDate);
    }
    if (options.variantKey) {
      conditions.push("il.variant_key = ?");
      params.push(options.variantKey);
    }

    let sql = `
      SELECT e.*, il.variant_key, il.experiment_key
      FROM events e
      JOIN inclusion_logs il ON il.user_uuid = e.user_uuid
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.timestamp`;
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows, rowCount: rows.length };
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    const rows = this.db
      .prepare("SELECT key, name, description, type FROM metrics ORDER BY key")
      .all() as Array<{
      key: string;
      name: string;
      description: string | null;
      type: "continuous" | "binary";
    }>;

    return rows.map((r) => ({
      key: r.key,
      name: r.name,
      ...(r.description != null ? { description: r.description } : {}),
      type: r.type,
    }));
  }

  async healthCheck(): Promise<boolean> {
    const row = this.db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return row?.ok === 1;
  }

  close(): void {
    this.db.close();
  }
}
