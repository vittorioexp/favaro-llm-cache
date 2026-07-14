import type { CacheMetrics, MetricsAdapter, MetricsConfig } from "@favaro/shared";
import { estimateObjectSize } from "@favaro/shared";

export class InMemoryMetricsAdapter implements MetricsAdapter {
  private metrics: CacheMetrics = createEmptyMetrics();
  private readonly prefix: string;

  constructor(config?: MetricsConfig) {
    this.prefix = config?.prefix ?? "favaro";
  }

  increment(name: string, value = 1, _tags?: Record<string, string>): void {
    const key = this.mapMetricName(name);
    if (!key) return;
    this.metrics[key] += value;
  }

  gauge(name: string, value: number, _tags?: Record<string, string>): void {
    const key = this.mapMetricName(name);
    if (!key) return;
    this.metrics[key] = value;
  }

  histogram(name: string, value: number, _tags?: Record<string, string>): void {
    if (name === "latency" || name.endsWith(".latency")) {
      this.metrics.totalLatencyMs += value;
    }
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = createEmptyMetrics();
  }

  recordHit(savedTokens = 0, savedCost = 0): void {
    this.metrics.hits++;
    this.metrics.savedRequests++;
    this.metrics.savedTokens += savedTokens;
    this.metrics.savedCost += savedCost;
  }

  recordMiss(): void {
    this.metrics.misses++;
  }

  recordDeduplication(): void {
    this.metrics.deduplicated++;
  }

  recordSemanticHit(): void {
    this.metrics.semanticHits++;
    this.metrics.hits++;
    this.metrics.savedRequests++;
  }

  recordError(): void {
    this.metrics.errors++;
  }

  recordCompression(originalSize: number, compressedSize: number): void {
    if (originalSize > 0) {
      const ratio = 1 - compressedSize / originalSize;
      this.metrics.compressionRatio =
        (this.metrics.compressionRatio + ratio) / 2;
    }
  }

  updateMemoryUsage(data: unknown): void {
    this.metrics.memoryUsageBytes += estimateObjectSize(data);
  }

  private mapMetricName(name: string): keyof CacheMetrics | null {
    const stripped = name.replace(`${this.prefix}.`, "").replace("cache.", "");
    const mapping: Record<string, keyof CacheMetrics> = {
      hits: "hits",
      misses: "misses",
      deduplicated: "deduplicated",
      "semantic.hits": "semanticHits",
      errors: "errors",
      "saved.requests": "savedRequests",
      "saved.tokens": "savedTokens",
      "saved.cost": "savedCost",
      entries: "entryCount",
      memory: "memoryUsageBytes",
    };
    return mapping[stripped] ?? null;
  }
}

function createEmptyMetrics(): CacheMetrics {
  return {
    hits: 0,
    misses: 0,
    deduplicated: 0,
    semanticHits: 0,
    errors: 0,
    totalLatencyMs: 0,
    savedRequests: 0,
    savedTokens: 0,
    savedCost: 0,
    compressionRatio: 0,
    memoryUsageBytes: 0,
    entryCount: 0,
  };
}

export function createMetricsAdapter(
  config?: boolean | MetricsConfig
): MetricsAdapter | null {
  if (config === false) return null;

  const resolved: MetricsConfig =
    typeof config === "boolean" || config === undefined
      ? { enabled: true }
      : config;

  if (!resolved.enabled) return null;

  return new InMemoryMetricsAdapter(resolved);
}

export function formatMetricsForOpenTelemetry(metrics: CacheMetrics): Record<string, number> {
  return {
    "favaro.cache.hits": metrics.hits,
    "favaro.cache.misses": metrics.misses,
    "favaro.cache.deduplicated": metrics.deduplicated,
    "favaro.cache.semantic_hits": metrics.semanticHits,
    "favaro.cache.errors": metrics.errors,
    "favaro.cache.latency_ms": metrics.totalLatencyMs,
    "favaro.cache.saved_requests": metrics.savedRequests,
    "favaro.cache.saved_tokens": metrics.savedTokens,
    "favaro.cache.saved_cost": metrics.savedCost,
    "favaro.cache.compression_ratio": metrics.compressionRatio,
    "favaro.cache.memory_bytes": metrics.memoryUsageBytes,
    "favaro.cache.entries": metrics.entryCount,
  };
}
