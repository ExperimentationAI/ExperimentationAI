import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../../src/memory/sqlite-store.js";

describe("SqliteStore", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("put and get", () => {
    it("stores and retrieves an item", async () => {
      await store.put(["experiments", "exp1", "conclusions"], "c1", {
        conclusion: "Treatment wins",
        timestamp: "2026-01-01T00:00:00Z",
      });

      const item = await store.get(["experiments", "exp1", "conclusions"], "c1");
      expect(item).not.toBeNull();
      expect(item!.value.conclusion).toBe("Treatment wins");
      expect(item!.key).toBe("c1");
      expect(item!.namespace).toEqual(["experiments", "exp1", "conclusions"]);
      expect(item!.createdAt).toBeInstanceOf(Date);
      expect(item!.updatedAt).toBeInstanceOf(Date);
    });

    it("returns null for missing key", async () => {
      const item = await store.get(["experiments"], "nonexistent");
      expect(item).toBeNull();
    });

    it("upserts on duplicate key", async () => {
      await store.put(["ns"], "k1", { version: 1 });
      await store.put(["ns"], "k1", { version: 2 });

      const item = await store.get(["ns"], "k1");
      expect(item!.value.version).toBe(2);
    });
  });

  describe("delete", () => {
    it("removes an item", async () => {
      await store.put(["ns"], "k1", { data: "hello" });
      await store.delete(["ns"], "k1");

      const item = await store.get(["ns"], "k1");
      expect(item).toBeNull();
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await store.put(["experiments", "exp1", "conclusions"], "c1", {
        conclusion: "First analysis",
        experimentKey: "exp1",
      });
      await store.put(["experiments", "exp1", "conclusions"], "c2", {
        conclusion: "Second analysis",
        experimentKey: "exp1",
      });
      await store.put(["experiments", "exp2", "conclusions"], "c3", {
        conclusion: "Different experiment",
        experimentKey: "exp2",
      });
      await store.put(["experiments", "conclusions"], "exp1-c1", {
        conclusion: "First analysis (global)",
        experimentKey: "exp1",
      });
    });

    it("returns items matching namespace prefix", async () => {
      const results = await store.search(["experiments", "exp1", "conclusions"]);
      expect(results).toHaveLength(2);
    });

    it("returns items under broader prefix", async () => {
      // Should match all items under ["experiments", ...]
      const results = await store.search(["experiments"], { limit: 100 });
      expect(results).toHaveLength(4);
    });

    it("respects limit", async () => {
      const results = await store.search(["experiments"], { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("respects offset", async () => {
      const all = await store.search(["experiments"], { limit: 100 });
      const page2 = await store.search(["experiments"], { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
      expect(page2[0].key).toBe(all[2].key);
    });

    it("applies filter on value fields", async () => {
      const results = await store.search(["experiments"], {
        filter: { experimentKey: "exp2" },
        limit: 100,
      });
      expect(results).toHaveLength(1);
      expect(results[0].value.experimentKey).toBe("exp2");
    });

    it("returns empty for non-matching prefix", async () => {
      const results = await store.search(["nonexistent"]);
      expect(results).toHaveLength(0);
    });
  });

  describe("listNamespaces", () => {
    beforeEach(async () => {
      await store.put(["experiments", "exp1", "conclusions"], "c1", { data: 1 });
      await store.put(["experiments", "exp2", "conclusions"], "c2", { data: 2 });
      await store.put(["experiments", "conclusions"], "c3", { data: 3 });
      await store.put(["other"], "k1", { data: 4 });
    });

    it("lists all namespaces", async () => {
      const ns = await store.listNamespaces();
      expect(ns).toHaveLength(4);
    });

    it("filters by prefix", async () => {
      const ns = await store.listNamespaces({ prefix: ["experiments"] });
      expect(ns).toHaveLength(3);
    });

    it("applies maxDepth", async () => {
      const ns = await store.listNamespaces({
        prefix: ["experiments"],
        maxDepth: 2,
      });
      // ["experiments","exp1","conclusions"] and ["experiments","exp2","conclusions"]
      // truncate to depth 2 → ["experiments","exp1"], ["experiments","exp2"], ["experiments","conclusions"]
      expect(ns).toHaveLength(3);
    });
  });

  describe("persistence", () => {
    it("data survives close and reopen on disk", async () => {
      // Use a temp file path
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-store-"));
      const dbPath = path.join(tmpDir, "test.db");

      try {
        const store1 = new SqliteStore(dbPath);
        await store1.put(["ns"], "key1", { persisted: true });
        store1.close();

        const store2 = new SqliteStore(dbPath);
        const item = await store2.get(["ns"], "key1");
        expect(item).not.toBeNull();
        expect(item!.value.persisted).toBe(true);
        store2.close();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });
});
