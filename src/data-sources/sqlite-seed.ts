import { SqliteDataSource } from "./sqlite.js";

export function seedDatabase(dbPath: string): SqliteDataSource {
  const ds = new SqliteDataSource(dbPath);

  // --- Metrics ---
  const metricsInsert = `INSERT OR REPLACE INTO metrics (key, name, description, type) VALUES (?, ?, ?, ?)`;
  const metrics: [string, string, string, string][] = [
    ["conversion_rate", "Conversion Rate", "Percentage of users who converted", "binary"],
    ["revenue_per_user", "Revenue Per User", "Average revenue per user in dollars", "continuous"],
    ["cart_abandonment", "Cart Abandonment", "Percentage of users who abandoned cart", "binary"],
    ["click_through_rate", "Click Through Rate", "Percentage of users who clicked", "binary"],
    ["avg_session_duration", "Average Session Duration", "Average session duration in seconds", "continuous"],
  ];
  for (const m of metrics) {
    ds.executeQuery(metricsInsert, m);
  }

  // --- Experiments ---
  const expInsert = `INSERT OR REPLACE INTO experiments (key, name) VALUES (?, ?)`;
  ds.executeQuery(expInsert, ["checkout-redesign", "Checkout Redesign"]);
  ds.executeQuery(expInsert, ["search-ranking-v2", "Search Ranking V2"]);

  // --- Experiment Metrics ---
  const emInsert = `INSERT OR REPLACE INTO experiment_metrics (experiment_key, metric_key, variant_key, sample_size, mean, std_dev, successes) VALUES (?, ?, ?, ?, ?, ?, ?)`;

  // checkout-redesign: conversion_rate (binary)
  ds.executeQuery(emInsert, ["checkout-redesign", "conversion_rate", "control", 1000, 0.12, 0, 120]);
  ds.executeQuery(emInsert, ["checkout-redesign", "conversion_rate", "treatment", 1000, 0.145, 0, 145]);

  // checkout-redesign: revenue_per_user (continuous)
  ds.executeQuery(emInsert, ["checkout-redesign", "revenue_per_user", "control", 1000, 4.20, 2.50, null]);
  ds.executeQuery(emInsert, ["checkout-redesign", "revenue_per_user", "treatment", 1000, 4.85, 2.80, null]);

  // checkout-redesign: cart_abandonment (binary)
  ds.executeQuery(emInsert, ["checkout-redesign", "cart_abandonment", "control", 1000, 0.68, 0, 680]);
  ds.executeQuery(emInsert, ["checkout-redesign", "cart_abandonment", "treatment", 1000, 0.62, 0, 620]);

  // search-ranking-v2: click_through_rate (binary)
  ds.executeQuery(emInsert, ["search-ranking-v2", "click_through_rate", "control", 800, 0.22, 0, 176]);
  ds.executeQuery(emInsert, ["search-ranking-v2", "click_through_rate", "variant_a", 800, 0.24, 0, 192]);
  ds.executeQuery(emInsert, ["search-ranking-v2", "click_through_rate", "variant_b", 800, 0.21, 0, 168]);

  // search-ranking-v2: avg_session_duration (continuous)
  ds.executeQuery(emInsert, ["search-ranking-v2", "avg_session_duration", "control", 800, 340, 120, null]);
  ds.executeQuery(emInsert, ["search-ranking-v2", "avg_session_duration", "variant_a", 800, 380, 130, null]);
  ds.executeQuery(emInsert, ["search-ranking-v2", "avg_session_duration", "variant_b", 800, 310, 110, null]);

  // --- Events (~200 rows) ---
  const evInsert = `INSERT INTO events (experiment_key, variant_key, event_name, user_id, value, timestamp, properties) VALUES (?, ?, ?, ?, ?, ?, ?)`;

  const rng = mulberry32(42); // deterministic seed
  const variants1 = ["control", "treatment"];
  const variants2 = ["control", "variant_a", "variant_b"];
  const baseDate = new Date("2025-01-15T00:00:00Z");

  // ~100 events for checkout-redesign
  for (let i = 0; i < 100; i++) {
    const variant = variants1[Math.floor(rng() * variants1.length)];
    const eventName = rng() < 0.6 ? "purchase" : "page_view";
    const userId = `user_${String(Math.floor(rng() * 500)).padStart(4, "0")}`;
    const value = eventName === "purchase" ? Math.round(rng() * 5000) / 100 : null;
    const ts = new Date(baseDate.getTime() + Math.floor(rng() * 30 * 86400000));
    const props = eventName === "purchase" ? JSON.stringify({ currency: "USD" }) : null;
    ds.executeQuery(evInsert, [
      "checkout-redesign", variant, eventName, userId, value, ts.toISOString(), props,
    ]);
  }

  // ~100 events for search-ranking-v2
  for (let i = 0; i < 100; i++) {
    const variant = variants2[Math.floor(rng() * variants2.length)];
    const eventName = rng() < 0.5 ? "search" : "click";
    const userId = `user_${String(Math.floor(rng() * 500)).padStart(4, "0")}`;
    const value = eventName === "search" ? Math.round(rng() * 1000) / 100 : null;
    const ts = new Date(baseDate.getTime() + Math.floor(rng() * 30 * 86400000));
    const props = eventName === "search" ? JSON.stringify({ query: "sample" }) : null;
    ds.executeQuery(evInsert, [
      "search-ranking-v2", variant, eventName, userId, value, ts.toISOString(), props,
    ]);
  }

  return ds;
}

/** Mulberry32 PRNG for deterministic seed data */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// CLI entry point
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/sqlite-seed.ts") ||
    process.argv[1].endsWith("/sqlite-seed.js"));

if (isMain) {
  const dbPathIdx = process.argv.indexOf("--db-path");
  const dbPath = dbPathIdx !== -1 && process.argv[dbPathIdx + 1]
    ? process.argv[dbPathIdx + 1]
    : "./data/local.db";

  console.log(`Seeding database at: ${dbPath}`);
  const ds = seedDatabase(dbPath);
  ds.close();
  console.log("Seed complete.");
}
