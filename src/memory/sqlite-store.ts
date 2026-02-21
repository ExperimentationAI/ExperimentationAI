import Database from "better-sqlite3";
import type {
  BaseStore,
  Item,
  Operation,
  OperationResults,
  GetOperation,
  PutOperation,
  SearchOperation,
  ListNamespacesOperation,
} from "@langchain/langgraph";

type SearchItem = Item & { score?: number };

const STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS store (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_store_namespace ON store(namespace);
`;

/**
 * Persistent BaseStore backed by SQLite.
 *
 * Drop-in replacement for InMemoryStore — swap to a PostgresStore later
 * by implementing the same BaseStore.batch() contract.
 */
export class SqliteStore implements BaseStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(STORE_SCHEMA);
  }

  // ---- BaseStore abstract method ----

  async batch<Op extends Operation[]>(
    operations: Op,
  ): Promise<OperationResults<Op>> {
    const results: unknown[] = [];

    for (const op of operations) {
      if (isGetOp(op)) {
        results.push(this.doGet(op));
      } else if (isPutOp(op)) {
        this.doPut(op);
        results.push(undefined);
      } else if (isSearchOp(op)) {
        results.push(this.doSearch(op));
      } else {
        // ListNamespacesOperation
        results.push(this.doListNamespaces(op as ListNamespacesOperation));
      }
    }

    return results as OperationResults<Op>;
  }

  // ---- Convenience methods (match BaseStore signatures) ----

  async get(namespace: string[], key: string): Promise<Item | null> {
    return (await this.batch([{ namespace, key } as GetOperation]))[0];
  }

  async search(
    namespacePrefix: string[],
    options: {
      filter?: Record<string, unknown>;
      limit?: number;
      offset?: number;
      query?: string;
    } = {},
  ): Promise<SearchItem[]> {
    const { filter, limit = 10, offset = 0, query } = options;
    return (
      await this.batch([
        { namespacePrefix, filter, limit, offset, query } as SearchOperation,
      ])
    )[0];
  }

  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    _index?: false | string[],
  ): Promise<void> {
    await this.batch([{ namespace, key, value } as PutOperation]);
  }

  async delete(namespace: string[], key: string): Promise<void> {
    await this.batch([{ namespace, key, value: null } as PutOperation]);
  }

  async listNamespaces(
    options: {
      prefix?: string[];
      suffix?: string[];
      maxDepth?: number;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<string[][]> {
    const { prefix, suffix, maxDepth, limit = 100, offset = 0 } = options;
    const matchConditions: Array<{
      matchType: "prefix" | "suffix";
      path: string[];
    }> = [];
    if (prefix) matchConditions.push({ matchType: "prefix", path: prefix });
    if (suffix) matchConditions.push({ matchType: "suffix", path: suffix });
    return (
      await this.batch([
        {
          matchConditions: matchConditions.length ? matchConditions : undefined,
          maxDepth,
          limit,
          offset,
        } as ListNamespacesOperation,
      ])
    )[0];
  }

  start(): void {
    // no-op
  }

  stop(): void {
    this.db.close();
  }

  close(): void {
    this.db.close();
  }

  // ---- Internal implementations ----

  private doGet(op: GetOperation): Item | null {
    const ns = encodeNamespace(op.namespace);
    const row = this.db
      .prepare("SELECT value, created_at, updated_at FROM store WHERE namespace = ? AND key = ?")
      .get(ns, op.key) as
      | { value: string; created_at: string; updated_at: string }
      | undefined;

    if (!row) return null;

    return {
      value: JSON.parse(row.value),
      key: op.key,
      namespace: op.namespace,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private doPut(op: PutOperation): void {
    const ns = encodeNamespace(op.namespace);

    if (op.value === null) {
      this.db
        .prepare("DELETE FROM store WHERE namespace = ? AND key = ?")
        .run(ns, op.key);
      return;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO store (namespace, key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(ns, op.key, JSON.stringify(op.value), now, now);
  }

  private doSearch(op: SearchOperation): SearchItem[] {
    const prefix = encodeNamespace(op.namespacePrefix);
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Namespace prefix match: either exact or starts with "prefix."
    if (prefix === "") {
      // Empty prefix matches everything
    } else {
      conditions.push("(namespace = ? OR namespace LIKE ?)");
      params.push(prefix, prefix + ".%");
    }

    let sql = `SELECT namespace, key, value, created_at, updated_at FROM store`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    params.push(op.limit ?? 10, op.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      namespace: string;
      key: string;
      value: string;
      created_at: string;
      updated_at: string;
    }>;

    let items: SearchItem[] = rows.map((row) => ({
      value: JSON.parse(row.value),
      key: row.key,
      namespace: decodeNamespace(row.namespace),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));

    // Apply filter on deserialized values
    if (op.filter) {
      items = items.filter((item) => matchesFilter(item.value, op.filter!));
    }

    return items;
  }

  private doListNamespaces(op: ListNamespacesOperation): string[][] {
    let sql = "SELECT DISTINCT namespace FROM store";
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (op.matchConditions) {
      for (const cond of op.matchConditions) {
        const encoded = encodeNamespace(cond.path);
        if (cond.matchType === "prefix") {
          conditions.push("(namespace = ? OR namespace LIKE ?)");
          params.push(encoded, encoded + ".%");
        } else {
          conditions.push("(namespace = ? OR namespace LIKE ?)");
          params.push(encoded, "%." + encoded);
        }
      }
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += ` LIMIT ? OFFSET ?`;
    params.push(op.limit ?? 100, op.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      namespace: string;
    }>;

    let namespaces = rows.map((row) => decodeNamespace(row.namespace));

    if (op.maxDepth != null) {
      namespaces = namespaces.map((ns) => ns.slice(0, op.maxDepth));
      // Deduplicate
      const seen = new Set<string>();
      namespaces = namespaces.filter((ns) => {
        const key = ns.join(".");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return namespaces;
  }
}

// ---- Helpers ----

function encodeNamespace(ns: string[]): string {
  return ns.join(".");
}

function decodeNamespace(encoded: string): string[] {
  return encoded === "" ? [] : encoded.split(".");
}

function matchesFilter(
  value: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const actual = value[key];
    if (condition != null && typeof condition === "object" && !Array.isArray(condition)) {
      const ops = condition as Record<string, unknown>;
      for (const [op, expected] of Object.entries(ops)) {
        switch (op) {
          case "$eq":
            if (actual !== expected) return false;
            break;
          case "$ne":
            if (actual === expected) return false;
            break;
          case "$gt":
            if (!(typeof actual === "number" && typeof expected === "number" && actual > expected))
              return false;
            break;
          case "$gte":
            if (!(typeof actual === "number" && typeof expected === "number" && actual >= expected))
              return false;
            break;
          case "$lt":
            if (!(typeof actual === "number" && typeof expected === "number" && actual < expected))
              return false;
            break;
          case "$lte":
            if (!(typeof actual === "number" && typeof expected === "number" && actual <= expected))
              return false;
            break;
        }
      }
    } else {
      if (actual !== condition) return false;
    }
  }
  return true;
}

// ---- Operation type guards ----

function isGetOp(op: Operation): op is GetOperation {
  return "namespace" in op && "key" in op && !("value" in op);
}

function isPutOp(op: Operation): op is PutOperation {
  return "namespace" in op && "key" in op && "value" in op;
}

function isSearchOp(op: Operation): op is SearchOperation {
  return "namespacePrefix" in op;
}
