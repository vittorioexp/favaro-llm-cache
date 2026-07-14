import type { FavaroCache } from "@favaro/core";
import { collectStream, replayStream } from "@favaro/core";
import type {
  CachedStreamResponse,
  FavaroConfig,
  LLMRequest,
  LLMResponse,
  ProviderName,
  SemanticConfig,
  StorageAdapter,
  StorageType,
  StreamChunk,
} from "@favaro/shared";
import { extractPromptText } from "@favaro/shared";
import { createMemoryStorage } from "@favaro/memory";
import { getProviderAdapter } from "@favaro/providers";
import { createHashEmbedding, createSemanticCache, type SemanticCache } from "@favaro/semantic";
import { createCache } from "@favaro/core";

export interface AIClientConfig extends FavaroConfig {
  provider: ProviderName;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  cache?: boolean;
  storage?: StorageType | StorageAdapter;
  semantic?: boolean | SemanticConfig;
  providerConfig?: Record<string, unknown>;
}

export interface AIClient {
  readonly provider: ProviderName;
  readonly cache: FavaroCache;
  chat(request: LLMRequest): Promise<LLMResponse>;
  chatStream(request: LLMRequest): AsyncIterable<StreamChunk>;
  invalidate(options?: Parameters<FavaroCache["invalidate"]>[0]): Promise<number>;
  getMetrics(): ReturnType<FavaroCache["getMetrics"]>;
  close(): Promise<void>;
}

export function createAIClient(config: AIClientConfig): AIClient {
  const storage = resolveStorage(config.storage);
  const cache = createCache(storage, buildCacheConfig(config));

  const providerAdapter = getProviderAdapter(config.provider);
  const providerClient = providerAdapter.createClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    ...config.providerConfig,
  });

  const defaultModel = config.model ?? "gpt-4o-mini";

  let semanticCache: SemanticCache | null = null;
  if (config.semantic) {
    const semanticConfig: SemanticConfig =
      typeof config.semantic === "boolean"
        ? { enabled: config.semantic }
        : { ...config.semantic, enabled: config.semantic.enabled ?? true };

    if (semanticConfig.enabled) {
      semanticCache = createSemanticCache({
        ...semanticConfig,
        storage,
        embedding: createHashEmbedding(),
      });
    }
  }

  return {
    provider: config.provider,
    cache,

    async chat(request: LLMRequest): Promise<LLMResponse> {
      const fullRequest = { ...request, model: request.model ?? defaultModel };

      if (!cache.isEnabled) {
        return providerAdapter.execute(providerClient, fullRequest);
      }

      const keyInput = {
        provider: config.provider,
        ...fullRequest,
      };
      const key = cache.buildKey(keyInput);

      const cached = await cache.get<LLMResponse>(key);
      if (cached) return cached.data;

      if (semanticCache) {
        const promptText = extractPromptText(fullRequest);
        if (promptText) {
          const match = await semanticCache.findSimilar<LLMResponse>(
            promptText,
            cache.namespace
          );
          if (match) return match.entry.data as LLMResponse;
        }
      }

      return cache.getDeduplicator().deduplicate(key, async () => {
        const response = await providerAdapter.execute(providerClient, fullRequest);
        const tokens = providerAdapter.estimateTokens?.(fullRequest, response) ?? 0;
        const cost =
          "estimateCost" in providerAdapter &&
          typeof providerAdapter.estimateCost === "function"
            ? providerAdapter.estimateCost(fullRequest, response)
            : 0;

        await cache.set(key, response, {
          provider: config.provider,
          model: fullRequest.model,
          tokenCount: tokens,
          cost,
          semantic: !!semanticCache,
        });

        if (semanticCache) {
          await semanticCache.indexFromRequest(key, cache.namespace, fullRequest);
        }

        return response;
      }) as Promise<LLMResponse>;
    },

    async *chatStream(request: LLMRequest): AsyncIterable<StreamChunk> {
      const fullRequest = { ...request, model: request.model ?? defaultModel, stream: true };
      const keyInput = {
        provider: config.provider,
        ...fullRequest,
        stream: false,
      };
      const key = cache.buildKey(keyInput);

      if (cache.isEnabled) {
        const cached = await cache.get<CachedStreamResponse>(`${key}:stream`);
        if (cached) {
          yield* replayStream(cached.data);
          return;
        }
      }

      const stream = providerAdapter.executeStream(providerClient, fullRequest);
      const buffer: StreamChunk[] = [];
      let index = 0;

      for await (const chunk of stream) {
        const indexed = { ...chunk, index: index++ };
        buffer.push(indexed);
        yield indexed;
      }

      if (cache.isEnabled && buffer.length > 0) {
        const cachedStream: CachedStreamResponse = {
          chunks: buffer,
          complete: true,
          fullContent: buffer.map((c) => c.content).join(""),
        };
        await cache.set(`${key}:stream`, cachedStream, {
          provider: config.provider,
          model: fullRequest.model,
        });
      }
    },

    invalidate(options) {
      return cache.invalidate(options);
    },

    getMetrics() {
      return cache.getMetrics();
    },

    async close() {
      semanticCache?.clearIndex();
      await cache.close();
    },
  };
}

function buildCacheConfig(config: AIClientConfig): FavaroConfig {
  const cacheConfig: FavaroConfig = {
    enabled: config.cache !== false,
  };

  if (config.namespace) cacheConfig.namespace = config.namespace;
  if (config.ttl !== undefined) cacheConfig.ttl = config.ttl;
  if (config.slidingExpiration !== undefined) cacheConfig.slidingExpiration = config.slidingExpiration;
  if (config.absoluteExpiration !== undefined) cacheConfig.absoluteExpiration = config.absoluteExpiration;
  if (config.compression !== undefined) cacheConfig.compression = config.compression;
  if (config.encryption !== undefined) cacheConfig.encryption = config.encryption;
  if (config.metrics !== undefined) cacheConfig.metrics = config.metrics;
  if (config.middleware) cacheConfig.middleware = config.middleware;
  if (config.keyBuilder) cacheConfig.keyBuilder = config.keyBuilder;
  if (config.ignoreFields) cacheConfig.ignoreFields = config.ignoreFields;
  if (config.version !== undefined) cacheConfig.version = config.version;
  if (config.maxEntries !== undefined) cacheConfig.maxEntries = config.maxEntries;
  if (config.cleanupInterval !== undefined) cacheConfig.cleanupInterval = config.cleanupInterval;
  if (config.sensitiveFields) cacheConfig.sensitiveFields = config.sensitiveFields;

  return cacheConfig;
}

function resolveStorage(storage?: StorageType | StorageAdapter): StorageAdapter {
  if (!storage || storage === "memory") {
    return createMemoryStorage();
  }

  if (typeof storage === "object" && "type" in storage) {
    return resolveStorage(storage.type as StorageType);
  }

  if (typeof storage === "object" && "get" in storage) {
    return storage as StorageAdapter;
  }

  switch (storage as StorageType) {
    case "memory":
      return createMemoryStorage();
    default:
      return createMemoryStorage();
  }
}

export async function createAIClientWithRedis(
  config: AIClientConfig & { redisUrl?: string }
): Promise<AIClient> {
  const { createRedisStorage } = await import("@favaro/redis");
  const storage = await createRedisStorage(
    config.redisUrl ? { url: config.redisUrl } : undefined
  );
  return createAIClient({ ...config, storage });
}

export async function createAIClientWithSqlite(
  config: AIClientConfig & { sqlitePath?: string }
): Promise<AIClient> {
  const { createSqliteStorage } = await import("@favaro/sqlite");
  const storage = await createSqliteStorage(
    config.sqlitePath ? { path: config.sqlitePath } : undefined
  );
  return createAIClient({ ...config, storage });
}
