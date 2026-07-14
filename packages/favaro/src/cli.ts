#!/usr/bin/env node
import { createMemoryStorage } from "@favaro/memory";
import { createCache, formatMetricsForOpenTelemetry } from "@favaro/core";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case "stats":
      await showStats();
      break;
    case "clear":
      await clearCache(args[1]);
      break;
    case "keys":
      await listKeys(args[1]);
      break;
    case "help":
    case "--help":
    case "-h":
    default:
      printHelp();
      break;
  }
}

async function showStats(): Promise<void> {
  const storage = createMemoryStorage();
  const cache = createCache(storage);
  const metrics = cache.getMetrics();
  const size = await cache.size();

  console.log("\n  Favaro Cache Statistics\n");
  console.log(`  Entries:      ${size}`);
  if (metrics) {
    console.log(`  Hits:         ${metrics.hits}`);
    console.log(`  Misses:       ${metrics.misses}`);
    console.log(`  Hit Ratio:    ${metrics.hits + metrics.misses > 0 ? ((metrics.hits / (metrics.hits + metrics.misses)) * 100).toFixed(1) : 0}%`);
    console.log(`  Deduplicated: ${metrics.deduplicated}`);
    console.log(`  Saved Tokens: ${metrics.savedTokens}`);
    console.log(`  Saved Cost:   $${metrics.savedCost.toFixed(4)}`);
    console.log(`  Memory:       ${(metrics.memoryUsageBytes / 1024).toFixed(1)} KB`);

    console.log("\n  OpenTelemetry Metrics:");
    const otel = formatMetricsForOpenTelemetry(metrics);
    for (const [key, value] of Object.entries(otel)) {
      console.log(`    ${key}: ${value}`);
    }
  }
  console.log();
  await cache.close();
}

async function clearCache(namespace?: string): Promise<void> {
  const storage = createMemoryStorage();
  const cache = createCache(storage);
  const deleted = await cache.invalidate(namespace ? { namespace } : undefined);
  console.log(`Cleared ${deleted} cache entries${namespace ? ` in namespace "${namespace}"` : ""}.`);
  await cache.close();
}

async function listKeys(pattern?: string): Promise<void> {
  const storage = createMemoryStorage();
  const cache = createCache(storage);
  const keys = await cache.keys(undefined, pattern);

  console.log(`\n  Cache Keys (${keys.length}):\n`);
  for (const key of keys.slice(0, 100)) {
    console.log(`  ${key}`);
  }
  if (keys.length > 100) {
    console.log(`  ... and ${keys.length - 100} more`);
  }
  console.log();
  await cache.close();
}

function printHelp(): void {
  console.log(`
  Favaro LLM Cache CLI

  Usage:
    favaro stats              Show cache statistics
    favaro clear [namespace]  Clear cache entries
    favaro keys [pattern]     List cache keys
    favaro help               Show this help

  Environment Variables:
    FAVARO_ENABLED            Enable/disable caching (default: true)
    FAVARO_NAMESPACE          Cache namespace (default: default)
    FAVARO_TTL                TTL in seconds (default: 3600)
    FAVARO_STORAGE            Storage type (memory, redis, sqlite)
    FAVARO_REDIS_URL          Redis connection URL
    FAVARO_SQLITE_PATH        SQLite database path
    FAVARO_SEMANTIC           Enable semantic cache (default: false)
    FAVARO_COMPRESSION        Enable compression (default: false)
    FAVARO_ENCRYPTION_KEY     Encryption key for cache entries
`);
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
