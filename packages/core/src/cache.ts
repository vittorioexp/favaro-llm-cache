import type {
  CacheEntry,
  CacheEntryMetadata,
  CacheKeyInput,
  CompressionAdapter,
  EncryptionAdapter,
  FavaroConfig,
  KeyBuilder,
  MetricsAdapter,
  Middleware,
  ProviderName,
  StorageAdapter,
} from "@favaro/shared";
import {
  ConfigurationError,
  generateCacheKey,
  JsonSerializer,
  loadConfigFromEnv,
  maskSensitiveFields,
  matchesPattern,
  now,
  resolveConfig,
} from "@favaro/shared";
import { createCompressionAdapter } from "./compression.js";
import { RequestDeduplicator } from "./deduplication.js";
import { createEncryptionAdapter } from "./encryption.js";
import { createMetricsAdapter, InMemoryMetricsAdapter } from "./metrics.js";
import { MiddlewarePipeline } from "./middleware.js";

export interface ResolvedFavaroConfig {
  enabled: boolean;
  namespace: string;
  ttl: number;
  slidingExpiration: boolean;
  absoluteExpiration: number | null;
  compression: CompressionAdapter | null;
  encryption: EncryptionAdapter | null;
  metrics: MetricsAdapter | null;
  middleware: MiddlewarePipeline;
  keyBuilder: KeyBuilder | null;
  ignoreFields: string[];
  version: number;
  maxEntries: number;
  cleanupInterval: number;
  sensitiveFields: string[];
}

export interface CacheGetOptions {
  namespace?: string;
  skipSemantic?: boolean;
}

export interface CacheSetOptions {
  namespace?: string;
  ttl?: number;
  tags?: string[];
  provider?: ProviderName;
  model?: string;
  tokenCount?: number;
  cost?: number;
  semantic?: boolean;
}

export interface InvalidateOptions {
  namespace?: string;
  pattern?: string;
  tags?: string[];
  keys?: string[];
}

const DEFAULT_CONFIG: ResolvedFavaroConfig = {
  enabled: true,
  namespace: "default",
  ttl: 3600_000,
  slidingExpiration: false,
  absoluteExpiration: null,
  compression: null,
  encryption: null,
  metrics: null,
  middleware: new MiddlewarePipeline(),
  keyBuilder: null,
  ignoreFields: [],
  version: 1,
  maxEntries: 100_000,
  cleanupInterval: 60_000,
  sensitiveFields: ["apiKey", "api_key", "token", "password", "secret"],
};

export class FavaroCache {
  private readonly config: ResolvedFavaroConfig;
  private readonly storage: StorageAdapter;
  private readonly serializer = new JsonSerializer();
  private readonly deduplicator = new RequestDeduplicator<unknown>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storage: StorageAdapter, config?: FavaroConfig) {
    this.storage = storage;
    this.config = this.resolveConfig(config);
    this.startCleanup();
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  get namespace(): string {
    return this.config.namespace;
  }

  buildKey(input: CacheKeyInput): string {
    const masked = maskSensitiveFields(
      input as Record<string, unknown>,
      this.config.sensitiveFields
    ) as CacheKeyInput;

    if (this.config.keyBuilder) {
      return this.config.keyBuilder(masked);
    }

    return generateCacheKey(
      { ...masked, version: this.config.version },
      {
        namespace: this.config.namespace,
        ignoreFields: this.config.ignoreFields,
      }
    );
  }

  async get<T>(key: string, options?: CacheGetOptions): Promise<CacheEntry<T> | null> {
    if (!this.config.enabled) return null;

    const namespace = options?.namespace ?? this.config.namespace;
    const start = now();

    await this.config.middleware.execute("before-cache", {
      namespace,
      key,
      request: { action: "get", key },
    });

    try {
      const stored = await this.storage.get<StoredPayload<T>>(key, namespace);
      if (!stored) {
        this.recordMiss();
        return null;
      }

      if (this.isExpired(stored.metadata)) {
        await this.storage.delete(key, namespace);
        this.recordMiss();
        return null;
      }

      const entry = await this.deserializeEntry<T>(stored);

      if (this.config.slidingExpiration && stored.metadata.expiresAt) {
        entry.metadata.lastAccessedAt = now();
        entry.metadata.accessCount++;
        const newExpiry = now() + this.config.ttl;
        entry.metadata.expiresAt = newExpiry;
        await this.storage.set(key, namespace, await this.serializeEntry(entry));
      } else {
        entry.metadata.lastAccessedAt = now();
        entry.metadata.accessCount++;
      }

      this.recordHit(entry.metadata);
      await this.config.middleware.execute("after-cache", {
        namespace,
        key,
        request: { action: "get", key },
        response: entry,
        metadata: entry.metadata,
      });

      return entry;
    } catch {
      this.recordError();
      return null;
    } finally {
      this.recordLatency(now() - start);
    }
  }

  async set<T>(key: string, data: T, options?: CacheSetOptions): Promise<void> {
    if (!this.config.enabled) return;

    const namespace = options?.namespace ?? this.config.namespace;
    const ttl = options?.ttl ?? this.config.ttl;
    const timestamp = now();

    const metadata: CacheEntryMetadata = {
      key,
      namespace,
      createdAt: timestamp,
      expiresAt: this.config.absoluteExpiration ?? timestamp + ttl,
      lastAccessedAt: timestamp,
      accessCount: 0,
      provider: options?.provider ?? "custom",
      model: options?.model ?? "unknown",
      version: this.config.version,
      compressed: false,
      encrypted: false,
      semantic: options?.semantic ?? false,
      tags: options?.tags ?? [],
    };

    if (options?.tokenCount !== undefined) metadata.tokenCount = options.tokenCount;
    if (options?.cost !== undefined) metadata.cost = options.cost;

    const entry: CacheEntry<T> = { data, metadata };

    await this.config.middleware.execute("before-cache", {
      namespace,
      key,
      request: { action: "set", key, data },
      metadata,
    });

    const serialized = await this.serializeEntry(entry);
    await this.storage.set(key, namespace, serialized);

    if (this.config.metrics instanceof InMemoryMetricsAdapter) {
      this.config.metrics.gauge("entries", await this.storage.size(namespace));
    }

    await this.config.middleware.execute("after-cache", {
      namespace,
      key,
      request: { action: "set", key },
      response: entry,
      metadata,
    });
  }

  async has(key: string, namespace?: string): Promise<boolean> {
    const getOptions: CacheGetOptions = namespace ? { namespace } : {};
    const entry = await this.get(key, getOptions);
    return entry !== null;
  }

  async delete(key: string, namespace?: string): Promise<boolean> {
    const ns = namespace ?? this.config.namespace;

    await this.config.middleware.execute("before-invalidation", {
      namespace: ns,
      key,
      request: { action: "delete", key },
    });

    const result = await this.storage.delete(key, ns);

    await this.config.middleware.execute("after-invalidation", {
      namespace: ns,
      key,
      request: { action: "delete", key },
      response: { deleted: result },
    });

    return result;
  }

  async invalidate(options?: InvalidateOptions): Promise<number> {
    const namespace = options?.namespace ?? this.config.namespace;
    let deleted = 0;

    await this.config.middleware.execute("before-invalidation", {
      namespace,
      key: "*",
      request: { action: "invalidate", options },
    });

    if (options?.keys) {
      for (const key of options.keys) {
        if (await this.delete(key, namespace)) deleted++;
      }
    }

    if (options?.pattern) {
      const keys = await this.storage.keys(namespace, options.pattern);
      for (const key of keys) {
        if (matchesPattern(key, options.pattern)) {
          if (await this.delete(key, namespace)) deleted++;
        }
      }
    }

    if (options?.tags && options.tags.length > 0) {
      const allKeys = await this.storage.keys(namespace);
      for (const key of allKeys) {
        const entry = await this.storage.get(key, namespace);
        if (entry && entry.metadata.tags.some((t) => options.tags!.includes(t))) {
          if (await this.delete(key, namespace)) deleted++;
        }
      }
    }

    if (!options?.keys && !options?.pattern && !options?.tags) {
      deleted = await this.storage.clear(namespace);
    }

    await this.config.middleware.execute("after-invalidation", {
      namespace,
      key: "*",
      request: { action: "invalidate", options },
      response: { deleted },
    });

    return deleted;
  }

  async wrap<T>(
    key: string,
    executor: () => Promise<T>,
    options?: CacheSetOptions
  ): Promise<T> {
    if (!this.config.enabled) {
      return executor();
    }

    const getOptions: CacheGetOptions = options?.namespace
      ? { namespace: options.namespace }
      : {};
    const cached = await this.get<T>(key, getOptions);
    if (cached !== null) {
      return cached.data;
    }

    return this.deduplicator.deduplicate(key, async () => {
      const result = await executor();
      await this.set(key, result, options);
      return result;
    }) as Promise<T>;
  }

  async keys(namespace?: string, pattern?: string): Promise<string[]> {
    return this.storage.keys(namespace ?? this.config.namespace, pattern);
  }

  async size(namespace?: string): Promise<number> {
    return this.storage.size(namespace ?? this.config.namespace);
  }

  getMetrics(): ReturnType<MetricsAdapter["getMetrics"]> | null {
    return this.config.metrics?.getMetrics() ?? null;
  }

  getDeduplicator(): RequestDeduplicator<unknown> {
    return this.deduplicator;
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.deduplicator.clear();
    await this.storage.close();
  }

  private resolveConfig(config?: FavaroConfig): ResolvedFavaroConfig {
    const envConfig = loadConfigFromEnv();
    const merged = resolveConfig(
      {
        enabled: DEFAULT_CONFIG.enabled,
        namespace: DEFAULT_CONFIG.namespace,
        ttl: DEFAULT_CONFIG.ttl,
        slidingExpiration: DEFAULT_CONFIG.slidingExpiration,
        absoluteExpiration: DEFAULT_CONFIG.absoluteExpiration,
        ignoreFields: DEFAULT_CONFIG.ignoreFields,
        version: DEFAULT_CONFIG.version,
        maxEntries: DEFAULT_CONFIG.maxEntries,
        cleanupInterval: DEFAULT_CONFIG.cleanupInterval,
        sensitiveFields: DEFAULT_CONFIG.sensitiveFields,
      },
      envConfig as Partial<FavaroConfig>,
      config as Partial<Record<string, unknown>> | undefined
    );

    return {
      ...DEFAULT_CONFIG,
      ...merged,
      compression: createCompressionAdapter(config?.compression ?? merged.compression as boolean),
      encryption: createEncryptionAdapter(config?.encryption ?? merged.encryption as boolean),
      metrics: createMetricsAdapter(config?.metrics ?? (merged.metrics as boolean | undefined) ?? true),
      middleware: new MiddlewarePipeline(config?.middleware ?? []),
      keyBuilder: config?.keyBuilder ?? null,
      absoluteExpiration: config?.absoluteExpiration ?? (merged.absoluteExpiration as number | null),
      ttl: typeof merged.ttl === "number" ? merged.ttl * (merged.ttl < 1_000_000 ? 1000 : 1) : DEFAULT_CONFIG.ttl,
    };
  }

  private isExpired(metadata: CacheEntryMetadata): boolean {
    if (metadata.expiresAt === null) return false;
    return now() > metadata.expiresAt;
  }

  private async serializeEntry<T>(entry: CacheEntry<T>): Promise<CacheEntry<T | StoredPayload<T>>> {
    if (!this.config.compression && !this.config.encryption) {
      return entry;
    }

    let payload: Buffer = Buffer.from(this.serializer.serialize(entry.data));
    const metadata = { ...entry.metadata, compressed: false, encrypted: false };

    if (this.config.compression?.shouldCompress(payload.length)) {
      const originalSize = payload.length;
      payload = Buffer.from(await this.config.compression.compress(payload));
      metadata.compressed = true;
      if (this.config.metrics instanceof InMemoryMetricsAdapter) {
        this.config.metrics.recordCompression(originalSize, payload.length);
      }
    }

    if (this.config.encryption) {
      payload = Buffer.from(await this.config.encryption.encrypt(payload));
      metadata.encrypted = true;
    }

    return {
      data: { raw: payload, encoding: metadata.encrypted ? "encrypted" : metadata.compressed ? "compressed" : "plain" },
      metadata,
    };
  }

  private async deserializeEntry<T>(stored: CacheEntry<T | StoredPayload<T>>): Promise<CacheEntry<T>> {
    if (!isStoredPayload(stored.data)) {
      return stored as CacheEntry<T>;
    }

    let payload = stored.data.raw;

    if (stored.metadata.encrypted && this.config.encryption) {
      payload = await this.config.encryption.decrypt(payload);
    }

    if (stored.metadata.compressed && this.config.compression) {
      payload = await this.config.compression.decompress(payload);
    }

    const data = this.serializer.deserialize<T>(payload);

    return {
      data,
      metadata: stored.metadata,
    };
  }

  private startCleanup(): void {
    if (this.config.cleanupInterval <= 0) return;

    this.cleanupTimer = setInterval(async () => {
      await this.runCleanup();
    }, this.config.cleanupInterval);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private async runCleanup(): Promise<void> {
    const keys = await this.storage.keys(this.config.namespace);
    const maxEntries = this.config.maxEntries;

    const expiredKeys: string[] = [];
    for (const key of keys) {
      const entry = await this.storage.get(key, this.config.namespace);
      if (entry && this.isExpired(entry.metadata)) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      await this.storage.delete(key, this.config.namespace);
    }

    const remaining = await this.storage.size(this.config.namespace);
    if (remaining > maxEntries) {
      const allKeys = await this.storage.keys(this.config.namespace);
      const entries: { key: string; lastAccessed: number }[] = [];

      for (const key of allKeys) {
        const entry = await this.storage.get(key, this.config.namespace);
        if (entry) {
          entries.push({ key, lastAccessed: entry.metadata.lastAccessedAt });
        }
      }

      entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
      const toRemove = remaining - maxEntries;

      for (let i = 0; i < toRemove && i < entries.length; i++) {
        const entry = entries[i];
        if (entry) {
          await this.storage.delete(entry.key, this.config.namespace);
        }
      }
    }
  }

  private recordHit(metadata: CacheEntryMetadata): void {
    if (this.config.metrics instanceof InMemoryMetricsAdapter) {
      this.config.metrics.recordHit(metadata.tokenCount ?? 0, metadata.cost ?? 0);
    }
  }

  private recordMiss(): void {
    if (this.config.metrics instanceof InMemoryMetricsAdapter) {
      this.config.metrics.recordMiss();
    }
  }

  private recordError(): void {
    if (this.config.metrics instanceof InMemoryMetricsAdapter) {
      this.config.metrics.recordError();
    }
  }

  private recordLatency(ms: number): void {
    this.config.metrics?.histogram("latency", ms);
  }
}

interface StoredPayload<T> {
  raw: Buffer;
  encoding: "plain" | "compressed" | "encrypted";
}

function isStoredPayload<T>(data: T | StoredPayload<T>): data is StoredPayload<T> {
  return (
    typeof data === "object" &&
    data !== null &&
    "raw" in data &&
    Buffer.isBuffer((data as StoredPayload<T>).raw)
  );
}

export function createCache(storage: StorageAdapter, config?: FavaroConfig): FavaroCache {
  if (!storage) {
    throw new ConfigurationError("Storage adapter is required");
  }
  return new FavaroCache(storage, config);
}
